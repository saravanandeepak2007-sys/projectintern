export default function Privacy() {
  return (
    <main className="wrap narrow">
      <h1 style={{ fontSize: '2.4rem' }}>How anonymity works</h1>
      <h3>What WhisperHub does</h3>
      <ul>
        <li>Senders never create an account and are never asked for a name, email or phone number.</li>
        <li>Each browser makes a separate random code for inboxes, rooms and polls. The server scrambles it again (a one-way hash) for every inbox and room before storing it, so receivers never see a usable code and the same browser looks different everywhere.</li>
        <li>Receivers can only read their own messages. Database rules (Row Level Security) enforce this on the server, not just in the page.</li>
        <li>Time capsules are hidden by the server until their unlock time, even from the receiver.</li>
        <li>Rooms give every visitor a random name like "Blue Falcon", saved only in their own browser. Rooms that are not in the public list can only be opened by people who have the code.</li>
        <li>To slow down spam, the server counts requests per network address using a one-way hash. That hash is deleted after an hour and is never stored with a message.</li>
      </ul>
      <h3>The honest limits</h3>
      <ul>
        <li>Anonymous does not mean untraceable. Hosting providers can keep ordinary network logs, and the writing style or content of a message can reveal its author.</li>
        <li>To make blocking possible, messages in the same inbox from the same browser carry the same scrambled code. Receivers can't see who it is, but they can tell that two messages came from one browser. Blocking only works per browser, so a sender who clears their data can write again.</li>
        <li>Voice notes can be recognised by the person's voice.</li>
        <li>Please don't use WhisperHub for harassment or threats. Receivers can delete messages, and room owners can remove posts and review reports.</li>
      </ul>
    </main>
  );
}
