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
- **A list per channel:** the panel that opens has the tabs **SMS**, **Push** and **OTT**. Each lists the messages of the business unit you are in.
  - **Columns:** name, key, status, and the dates a message was created and last changed, in your local date and time. SMS also shows **Code** and **Keyword**, push shows **App** and **Content** by their names.
  - **Search:** type into the search box to filter by name, key and the channel columns.
  - **Sorting:** click a column heading; click again to turn the order round.
  - **Pages:** 50 messages per page, with **Previous** and **Next**.
  - **Long lists are read completely.** The panel reads 100 messages per request until Marketing Cloud has no more.
- **The list is kept, not read again and again:** switching tabs, coming back from a message and reopening the panel show the list from memory.
  - It is read again after you created, changed or deleted a message in the panel, when you click **Refresh**, and after you reload the page.
  - A note next to **Refresh** says when the list was read.
  - It is also dropped when you change the business unit.
- **Code, keyword, app and content come a moment later:** Marketing Cloud's list does not contain them, so the panel reads each message once in the background, a few at a time, and says how far it is ("details 120 of 312").
  - What was read is kept for as long as the page is open. After a refresh, only messages that are new or were changed are read again.
  - Until all are read, sorting by these columns is switched off, and a search finds them only in the messages already read.
  - On the first opening of a list with several hundred messages, that many requests go out once.
- **The details of one message:** click a row to see everything Marketing Cloud stores for it, with plain labels such as **Key**, **Message** or **Code**. Point at a label to see the name of the field in the API. For a push message the name of its app and of its content stands next to their IDs. **← All … messages** takes you back.
- **Create a message:** every list has a **New … message** button. It opens a form with the fields of that channel:
  - **SMS:** name, key, description, status, the text of the message, the code and keyword it is sent with, the country code of a short code, and whether the recipient is added or updated as a subscriber.
  - **Push:** name, key, description, status, the app, the content (the customer key of the push message in Content Builder), sound and badge.
  - **OTT:** name, key, description, status, the sender (WhatsApp and its phone number) and the content.
- **The key follows the name** while you type, as with [readable keys](README.md#readable-keys) elsewhere, until you type a key yourself. The **Readable keys** option switches this off.
- **SMS code and keyword are two lists:** choose the code first; the keyword list then shows only the keywords of that code. A code reads like `8850 · NL · short code · SHARED`.
  - If Marketing Cloud's lists cannot be read, both are plain text fields.
  - When you edit a message whose code or keyword is not in the lists, it stays chosen and is marked as not found.
  - The lists show what Marketing Cloud returns in its first answer, which is up to 50 codes and 50 keywords.
- **The app of a push message is suggested** by name, and the name of what you chose stands under the field. The field still takes any other ID.
- **The content of a push message is suggested:** the field offers the push messages of Content Builder by their name. Picking one fills in its customer key. Messages written for SMS or for in-app are left out: on an account with push messages, every transactional one held a message written for push. The field still takes any other key.
- **What Marketing Cloud refuses is shown:** if a message cannot be created, the form says why in Marketing Cloud's words and keeps what you typed.
- **A new message starts as Active** unless you choose another status in the form. An active message can be sent at once by anything that knows its key.
  - **Push has three statuses:** Active, Inactive and Draft. Marketing Cloud stores a new push message as Draft unless it is Active, also when you choose Inactive.
- **Links in an SMS:** two optional boxes switch on Marketing Cloud's link shortening and its tracking of the shortened links per subscriber.
- **Change a message:** the details have an **Edit** button. It opens the same form, filled in. The key cannot be changed.
  - Only what you changed is sent. If you change nothing, nothing is sent.
  - Right before saving, the panel reads the message again. If someone changed it meanwhile, or you changed the business unit in another browser tab, nothing is saved and the form says so.
  - After saving, the panel reads the message once more and compares it with what you sent. If Marketing Cloud answered "saved" but holds something else, the panel names the fields that differ.
- **Delete a message:** the details have a **Delete** button. The panel then asks once more, with the name, key and status of the message, and only **Delete it** deletes. Marketing Cloud cannot bring a deleted message back, and whatever still sends with its key will fail.
- **A safeguard against the wrong business unit:** right before deleting, the panel reads the message again. If it is no longer the one on screen, for example because you changed the business unit in another browser tab, nothing is deleted.
- **Creating, changing and deleting were tried on real messages:** on a business unit with SMS and push, a test message of each kind was created, changed and deleted through the panel, and nothing else on that business unit changed. OTT could not be tried, see below.
- **What Marketing Cloud does with a deleted message:** it keeps it, marked as deleted, and replaces its key and name with a random ID, so the key is free again. The panel leaves deleted messages out.
- **Always marked as ours:** the panel shows the icon and **SFMC UX Tools** at its top, so nobody takes it for a part of Marketing Cloud.
- **OTT is untested:** it was built from Salesforce's documentation, because we have no account with WhatsApp or a similar channel. If you have one, please tell us whether it works, in the [issues on GitHub](https://github.com/JoernBerkefeld/chrome-sfmc-ux-tools/issues). The tab says so too.
