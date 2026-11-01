"""
Tiny stand-in for Supabase (PostgREST + auth + storage) in front of a REAL local Postgres, for end-to-end tests only.
Every request runs as the 'anon' or 'authenticated' role with the caller's user id, so the real RLS policies,
triggers and functions from schema.sql decide what is allowed. Not for production use.
Usage: python3 mock_supabase.py <database> [port]
"""
import base64, json, re, sys, time, uuid
import psycopg2, psycopg2.extras
from flask import Flask, request, Response, make_response

DB = sys.argv[1] if len(sys.argv) > 1 else 'wh_e2e'
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 54321
app = Flask(__name__)
USERS = {}      # email -> {id, password}
BLOBS = set()   # storage paths that exist
SECRET = 'e2e-secret'
IDENT = re.compile(r'^[a-z_][a-z0-9_]*$')


def b64(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b'=').decode()
def jwt_for(uid, email):
    return f"{b64({'alg':'HS256','typ':'JWT'})}.{b64({'sub':uid,'role':'authenticated','aud':'authenticated','email':email,'exp':int(time.time())+3600})}.sig"
def session_for(uid, email):
    now = int(time.time())
    return {'access_token': jwt_for(uid, email), 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': now + 3600,
            'refresh_token': 'r-' + uid, 'user': user_json(uid, email)}
def user_json(uid, email):
    return {'id': uid, 'aud': 'authenticated', 'role': 'authenticated', 'email': email, 'app_metadata': {}, 'user_metadata': {}, 'created_at': '2026-11-01T00:00:00Z'}
def caller():
    h = request.headers.get('Authorization', '')
    tok = h.replace('Bearer ', '')
    parts = tok.split('.')
    if len(parts) == 3:
        try:
            pl = json.loads(base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4)))
            if pl.get('role') == 'authenticated' and pl.get('sub'): return 'authenticated', pl['sub']
        except Exception: pass
    return 'anon', ''
def conn(role, sub):
    c = psycopg2.connect(dbname=DB, host='/var/run/postgresql')
    cur = c.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    hdrs = {'x-forwarded-for': request.headers.get('X-Test-Ip') or request.headers.get('X-Forwarded-For') or ''}
    cur.execute(f'set local role {role}')
    cur.execute("select set_config('request.jwt.claim.sub', %s, true), set_config('request.headers', %s, true)", (sub, json.dumps(hdrs)))
    return c, cur
def cors(r):
    r.headers['Access-Control-Allow-Origin'] = '*'
    r.headers['Access-Control-Allow-Headers'] = '*'
    r.headers['Access-Control-Allow-Methods'] = 'GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS'
    r.headers['Access-Control-Expose-Headers'] = 'Content-Range,Content-Profile'
    return r
@app.after_request
def _c(r): return cors(r)
@app.route('/<path:p>', methods=['OPTIONS'])
def _o(p): return cors(make_response('', 204))
def jerr(status, code, msg): return Response(json.dumps({'code': code, 'message': msg, 'details': None, 'hint': None}), status, mimetype='application/json')
def pg_err(e):
    code = getattr(e, 'pgcode', None) or 'XX000'
    msg = (getattr(e, 'pgerror', None) or str(e)).split('\n')[0].replace('ERROR:  ', '')
    status = {'23505': 409, '42501': 403, '23514': 400, 'P0001': 400, '23503': 409}.get(code, 400)
    return jerr(status, code, msg)

def where_from_args(args):
    clauses, params = [], []
    for k, v in args.items(multi=True):
        if k in ('select', 'order', 'limit', 'offset', 'on_conflict', 'columns'): continue
        m = re.match(r'^(eq|neq|lt|lte|gt|gte|in|is)\.(.*)$', v)
        if not m or not IDENT.match(k): raise ValueError('bad filter ' + k)
        op, val = m.groups()
        if op == 'in':
            items = [x.strip().strip('"') for x in val.strip('()').split(',') if x.strip()]
            clauses.append(f'"{k}"::text = any(%s)'); params.append(items)
        elif op == 'is':
            clauses.append(f'"{k}" is {"null" if val=="null" else "not null"}')
        else:
            sym = {'eq': '=', 'neq': '<>', 'lt': '<', 'lte': '<=', 'gt': '>', 'gte': '>='}[op]
            clauses.append(f'"{k}"::text {sym} %s' if op in ('eq', 'neq') else f'"{k}" {sym} %s'); params.append(val)
    return (' where ' + ' and '.join(clauses)) if clauses else '', params

@app.route('/rest/v1/rpc/<fn>', methods=['POST'])
def rpc(fn):
    if not IDENT.match(fn): return jerr(400, 'PGRST000', 'bad function')
    role, sub = caller(); args = request.get_json(silent=True) or {}
    c, cur = conn(role, sub)
    try:
        cur.execute("select p.proretset, format_type(p.prorettype, null) as rt from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=%s", (fn,))
        meta = cur.fetchone()
        if not meta: return jerr(404, 'PGRST202', f'function {fn} not found')
        names = [k for k in args if IDENT.match(k)]
        call = f'public.{fn}(' + ', '.join(f'{k} := %s' for k in names) + ')'
        vals = [args[k] for k in names]
        if meta['proretset']:
            cur.execute(f'select coalesce(json_agg(t), \'[]\'::json) as j from {call} t', vals); out = cur.fetchone()['j']
        elif meta['rt'] == 'void':
            cur.execute(f'select {call}', vals); c.commit(); return cors(make_response('', 204))
        else:
            cur.execute(f'select to_json({call}) as j', vals); out = cur.fetchone()['j']
        c.commit(); return Response(json.dumps(out), 200, mimetype='application/json')
    except psycopg2.Error as e:
        c.rollback(); return pg_err(e)
    finally: c.close()

@app.route('/rest/v1/<table>', methods=['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'])
def rest(table):
    if not IDENT.match(table): return jerr(400, 'PGRST000', 'bad table')
    role, sub = caller(); c, cur = conn(role, sub)
    prefer = request.headers.get('Prefer', '')
    try:
        if request.method in ('GET', 'HEAD'):
            sel = request.args.get('select', '*'); cols = '*' if sel == '*' else ', '.join(f'"{x.strip()}"' for x in sel.split(',') if IDENT.match(x.strip()))
            w, params = where_from_args(request.args)
            order = ''
            if request.args.get('order'):
                o = []
                for part in request.args['order'].split(','):
                    f, *d = part.split('.')
                    if IDENT.match(f): o.append(f'"{f}" ' + ('desc' if 'desc' in d else 'asc'))
                order = ' order by ' + ', '.join(o) if o else ''
            lim = f' limit {int(request.args["limit"])}' if request.args.get('limit') else ''
            if request.method == 'HEAD' or 'count=exact' in prefer:
                cur.execute(f'select count(*) as n from public."{table}"{w}', params); n = cur.fetchone()['n']
                if request.method == 'HEAD': c.commit(); r = make_response('', 200); r.headers['Content-Range'] = f'*/{n}'; return r
            cur.execute(f'select coalesce(json_agg(t), \'[]\'::json) as j from (select {cols} from public."{table}"{w}{order}{lim}) t', params)
            out = cur.fetchone()['j']; c.commit()
            if 'vnd.pgrst.object' in request.headers.get('Accept', ''):
                if len(out) != 1: return jerr(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned')
                out = out[0]
            r = Response(json.dumps(out), 200, mimetype='application/json')
            if 'count=exact' in prefer: r.headers['Content-Range'] = f'0-{max(len(out)-1,0)}/{len(out)}'
            return r
        if request.method == 'POST':
            body = request.get_json(); rows = body if isinstance(body, list) else [body]
            returned = []
            for row in rows:
                ks = [k for k in row if IDENT.match(k)]
                sql = f'insert into public."{table}" (' + ', '.join(f'"{k}"' for k in ks) + ') values (' + ', '.join(['%s'] * len(ks)) + ')'
                if 'return=representation' in prefer: sql += ' returning to_json("' + table + '") as j'
                cur.execute(sql, [row[k] for k in ks])
                if 'return=representation' in prefer and cur.rowcount: returned.append(cur.fetchone()['j'])
            c.commit()
            if 'return=representation' in prefer:
                return Response(json.dumps(returned if isinstance(body, list) else (returned[0] if returned else None)), 201, mimetype='application/json')
            return cors(make_response('', 201))
        w, params = where_from_args(request.args)
        if request.method == 'PATCH':
            body = request.get_json(); ks = [k for k in body if IDENT.match(k)]
            cur.execute(f'update public."{table}" set ' + ', '.join(f'"{k}" = %s' for k in ks) + w, [body[k] for k in ks] + params)
        else:
            cur.execute(f'delete from public."{table}"{w}', params)
        c.commit(); return cors(make_response('', 204))
    except (psycopg2.Error, ValueError) as e:
        c.rollback(); return pg_err(e) if isinstance(e, psycopg2.Error) else jerr(400, 'PGRST100', str(e))
    finally: c.close()

# ------------------------------------------------------------ auth
@app.route('/auth/v1/signup', methods=['POST'])
def signup():
    b = request.get_json(); email = b['email'].lower()
    if email in USERS: return jerr(422, 'user_already_exists', 'User already registered')
    c = psycopg2.connect(dbname=DB, host='/var/run/postgresql'); cur = c.cursor()
    cur.execute('insert into auth.users (email, raw_user_meta_data) values (%s, %s) returning id', (email, json.dumps(b.get('data') or {})))
    uid = str(cur.fetchone()[0]); c.commit(); c.close()
    USERS[email] = {'id': uid, 'password': b['password']}
    return Response(json.dumps(session_for(uid, email)), 200, mimetype='application/json')
@app.route('/auth/v1/token', methods=['POST'])
def token():
    gt = request.args.get('grant_type'); b = request.get_json() or {}
    if gt == 'password':
        u = USERS.get((b.get('email') or '').lower())
        if not u or u['password'] != b.get('password'): return jerr(400, 'invalid_credentials', 'Invalid login credentials')
        return Response(json.dumps(session_for(u['id'], b['email'].lower())), 200, mimetype='application/json')
    rt = (b.get('refresh_token') or '')[2:]
    for email, u in USERS.items():
        if u['id'] == rt: return Response(json.dumps(session_for(u['id'], email)), 200, mimetype='application/json')
    return jerr(400, 'bad_refresh', 'Invalid refresh token')
@app.route('/auth/v1/user', methods=['GET'])
def me():
    role, sub = caller()
    for email, u in USERS.items():
        if u['id'] == sub: return Response(json.dumps(user_json(sub, email)), 200, mimetype='application/json')
    return jerr(401, 'no_user', 'Invalid token')
@app.route('/auth/v1/logout', methods=['POST'])
def logout(): return cors(make_response('', 204))

# ------------------------------------------------------------ storage (rows in storage.objects go through the real policies)
@app.route('/storage/v1/object/voice/<path:p>', methods=['POST'])
def upload(p):
    role, sub = caller(); c, cur = conn(role, sub)
    try:
        cur.execute("insert into storage.objects (bucket_id, name) values ('voice', %s)", (p,)); c.commit(); BLOBS.add(p)
        return Response(json.dumps({'Key': 'voice/' + p, 'Id': str(uuid.uuid4())}), 200, mimetype='application/json')
    except psycopg2.Error as e: c.rollback(); return pg_err(e)
    finally: c.close()
@app.route('/storage/v1/object/sign/voice/<path:p>', methods=['POST', 'GET'])
def sign(p):
    if request.method == 'GET': return Response(b'RIFF....fake-audio', 200, mimetype='audio/webm')
    role, sub = caller(); c, cur = conn(role, sub)
    try:
        cur.execute("select 1 from storage.objects where bucket_id='voice' and name=%s", (p,)); ok = cur.fetchone(); c.commit()
        if not ok: return jerr(404, 'not_found', 'Object not found')
        return Response(json.dumps({'signedURL': f'/object/sign/voice/{p}?token=t'}), 200, mimetype='application/json')
    finally: c.close()
@app.route('/storage/v1/object/voice', methods=['DELETE'])
def remove():
    role, sub = caller(); c, cur = conn(role, sub); out = []
    try:
        for p in (request.get_json() or {}).get('prefixes', []):
            cur.execute("delete from storage.objects where bucket_id='voice' and name=%s", (p,))
            if cur.rowcount: out.append({'name': p}); BLOBS.discard(p)
        c.commit(); return Response(json.dumps(out), 200, mimetype='application/json')
    finally: c.close()
@app.route('/__state')
def state(): return Response(json.dumps({'blobs': sorted(BLOBS)}), 200, mimetype='application/json')

if __name__ == '__main__':
    app.run(port=PORT, threaded=True)
