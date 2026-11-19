# Preview features

Features of SFMC UX Tools that are built but not finished. They are switched off after installing and the options do not show them.

## Switch a preview feature on

- Click the extension's icon in Chrome's toolbar to open the options.
- Hold **Alt** and click the **©** sign at the bottom right.
- A group **Preview features** appears. Choose **on** for the feature.
- The change applies at once; no reload is needed.
- While a preview feature is on, the group shows by itself, so that you can switch it off again.

## Transactional messages: SMS, push and OTT

Marketing Cloud can send transactional SMS, push and OTT messages (OTT covers WhatsApp and similar channels). They are set up through the API only: no app of Marketing Cloud shows which ones exist.

- **A new entry in the menu:** point at **Mobile Studio** at the top of Marketing Cloud. Below MobileConnect, MobilePush and GroupConnect you find **Transactional Messages**. The small icon behind it is this extension's, to show who added the entry.
- **A list per channel:** the panel that opens has the tabs **SMS**, **Push** and **OTT**. Each lists the messages of the business unit you are in, with name, key, status and the dates they were created and last changed.
- **The details of one message:** click a row to see everything Marketing Cloud stores for it, such as the text, the code and keyword, or the app. **← All … messages** takes you back.
- **Create a message:** every list has a **New … message** button. It opens a form with the fields of that channel:
  - **SMS:** name, key, description, status, the text of the message, the code and keyword it is sent with, the country code of a short code, and whether the recipient is added or updated as a subscriber.
  - **Push:** name, key, description, status, the app, the content (the customer key of the push message in Content Builder), sound and badge.
  - **OTT:** name, key, description, status, the sender (WhatsApp and its phone number) and the content.
- **The key follows the name** while you type, as with [readable keys](README.md#readable-keys) elsewhere, until you type a key yourself. The **Readable keys** option switches this off.
- **Code, keyword and app are suggested:** these fields offer what the business unit has, and still take any text.
- **The content of a push message is suggested:** the field offers the push messages of Content Builder by their name. Picking one fills in its customer key. Messages written for SMS or for in-app are left out: on an account with push messages, every transactional one held a message written for push. The field still takes any other key.
- **What Marketing Cloud refuses is shown:** if a message cannot be created, the form says why in Marketing Cloud's words and keeps what you typed.
- **A new message starts as Active** unless you choose Inactive in the form. An active message can be sent at once by anything that knows its key.
- **Change a message:** the details have an **Edit** button. It opens the same form, filled in. The key cannot be changed.
  - Only what you changed is sent. If you change nothing, nothing is sent.
  - Right before saving, the panel reads the message again. If someone changed it meanwhile, or you changed the business unit in another browser tab, nothing is saved and the form says so.
  - After saving, the panel reads the message once more and compares it with what you sent. If Marketing Cloud answered "saved" but holds something else, the panel names the fields that differ.
- **Delete a message:** the details have a **Delete** button. The panel then asks once more, with the name, key and status of the message, and only **Delete it** deletes. Marketing Cloud cannot bring a deleted message back, and whatever still sends with its key will fail.
- **A safeguard against the wrong business unit:** right before deleting, the panel reads the message again. If it is no longer the one on screen, for example because you changed the business unit in another browser tab, nothing is deleted.
- **Creating, changing and deleting are untested on a real message:** our test account has no SMS code, push app or OTT channel, so Marketing Cloud refuses every new message there, and there is none to change or delete. We saw that the requests arrive and are checked. For changing an SMS message even that could not be seen clearly. They are the ones Marketing Cloud's API documents and [mcdev](https://github.com/Accenture/sfmc-devtools) uses. If it does not work for you, please tell us in the [issues on GitHub](https://github.com/JoernBerkefeld/chrome-sfmc-ux-tools/issues).
- **Always marked as ours:** the panel shows the icon and **SFMC UX Tools** at its top, so nobody takes it for a part of Marketing Cloud.
- **OTT is untested:** it was built from Salesforce's documentation, because we have no account with WhatsApp or a similar channel. If you have one, please tell us whether it works, in the [issues on GitHub](https://github.com/JoernBerkefeld/chrome-sfmc-ux-tools/issues). The tab says so too.
