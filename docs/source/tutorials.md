# Five-minute tutorials

```{admonition} Depends on #56
:class: important

These two tutorials describe the guided first-run journeys and the Explore → My Network handoffs added by issue #56 ([PR #66](https://github.com/dhuzard/science-record-player/pull/66)). The labels follow that pull request at its reviewed head `9902c71` (14 November 2026). They have **not yet been checked on the live site**; if a label differs there, please [tell us](feedback.md). The [Get started](getting-started.md) steps do not depend on #56.
```

Both tutorials work without an account, a GitHub login or cloud Teams (which are not available). Each one says when something is read from ORCID and where your data ends up.

## Tutorial 1 — Explore & Play: one record, many outputs

**You end with:** a trading card, a record check report and a citation file for one public record. **About 5 minutes, 5 steps.**

1. **Open a profile.** Go to [Explore](https://science-record-player.web.app/). Below the two paths, **Explore & Play, step by step** lists the same steps as this tutorial. Choose **Use the stored demo profile**: it is read from this site, with no ORCID request. To use another record, enter its ORCID iD and select **Explore**; that reads the public record from `pub.orcid.org`.
2. **Look around.** The result has tabs: **Profile**, **Trading card**, **Heatmap**, **Wrapped**, **Fortune**, **Record check**, **Funder biosketch** and **Citations & data**. Everything is computed in your browser.
3. **Check the record.** Open **Record check** and download its report. Make any fixes **in ORCID itself**; this tool never changes a record. The score is this tool's completeness rubric, not research merit.
4. **Export what you need.** Under the result, **What can I do next?** links to the trading card and heatmap (SVG downloads), the record check and **Citations & data** (BibTeX, RIS, CSL JSON, or the structured biosketch with its provenance). Downloads are saved on your device only.
5. **Keep the researcher, if you like.** **Keep this researcher in My Network** offers **Save as contact**, **Add to group** or **Follow**. Each opens My Network with the ORCID iD filled in and **asks before anything is read or saved**. Open **Follow, Contact, Group, Team: what's the difference?** to compare them. Tutorial 2 continues from here.

**Data locality:** Explore runs in your browser and does not store the record on a server; the files you download stay on your device.

## Tutorial 2 — Connect & Organize: Explore → Contact → Group

**You end with:** one researcher saved as a contact with a context, a private note and a follow-up, in a local group with a selected project output, and a downloaded team pack. **About 5 minutes, 7 steps**, matching the 7 steps of **Connect & Organize, step by step** in My Network.

1. **Save a researcher as a contact.** In Explore, open the stored demo profile (Tutorial 1, step 1), then choose **Save as contact**. My Network opens with a **FROM EXPLORE** panel, with the keyboard focus on its heading. Optionally fill **Conference or context (optional)** (for example the meeting where you met), **Date met (optional)** and **Private note (optional)**; a date is recorded only if you enter one. Then choose **Read record & save as contact**. This reads that one public record from ORCID; **Cancel** reads and saves nothing. Saving a contact does not change whether you follow them: the confirmation says “You already follow them; that is unchanged.”, or that they are *not followed* and you can choose **Follow** in People if you want their new outputs in your Feed.
2. **Read where your network lives.** The **Where your network lives** note explains that My Network is stored only in this browser and is lost if you clear the site's data, close a private window, or switch browser or device. Choose **Download a backup now** (or **Download my workspace** in the sidebar) before you invest time in notes. The backup file is not encrypted and contains your notes; **Restore from file** brings it back.
3. **Add a note and plan a follow-up.** In **Contacts**, on the contact card, use **Add tag** if you skipped the context, **Add note** for a private note and **Add follow-up** with a due date. Nobody is notified.
4. **Go back to Explore.** On the contact card, choose **Open in Explore →**. Explore opens with the same iD filled in and waits: press **Explore** to read the public record (or choose the stored demo profile again). **← Back to My Network** returns to Contacts, even after you refresh Explore.
5. **Add the contact to a group.** On the result, choose **Add to group**. In the **FROM EXPLORE** panel, the **Group** list starts on one of your own groups that does not yet include this researcher, or on **A new group…** if there is none; it never starts on the sample group. Pick **A new group…**, type a **New group name** and choose **Add to group**. The researcher is already in your workspace, so nothing new is read from ORCID and no duplicate is created.
6. **Select a project output.** In **Groups**, open the group and its **Project outputs** tab. Member outputs are only suggestions: choose **+ Select for project** on one that belongs to the project. This is your local decision; it does not confirm attribution with the authors.
7. **Download the team pack.** Open **Team pack** and choose **↓ Download team pack**. The pack contains the roster, bibliography, member biosketches and a manifest, and **no contact tags, notes or follow-ups**.

**Prefer sample data?** **Explore sample data** in My Network asks first. If this browser already holds your own network, the question gives its counts; the sample is added next to it, never in its place, and every item is labelled **Demo**. Sample groups appear in group lists as “… (sample group)”; a real researcher you add to one is your own data. **Remove sample data** in the sample banner asks first and says how many sample people it removes, with their Demo outputs and anything you added to them. An unchanged sample group is deleted. A sample group that holds your own members, requests or text (a name or description you changed) is kept, renamed without “· Demo” (for example “Open Science Circle”), without the sample people; its name, description, and the roles, selected outputs and requests of your own members are kept. The notice afterwards ends with “Kept as your own group: …”. Demo people have no ORCID iD, so they have no Explore or Public Group View link.

**Data locality:** the contact, note, follow-up, group and selection live only in this browser. ORCID is read once, when you confirm in step 1. A local group is your own annotation: the people listed are not notified and have not confirmed membership. It is not a [Public Group View](groups.md) link and not a private cloud Team.

## Links into My Network

These addresses open the handoffs directly; each still asks before reading or saving anything. While a handoff question is open, My Network's **Guide** button is disabled (“Answer or cancel the pending question first”).

| Address | Opens |
| --- | --- |
| `/network/#contacts?save=<ORCID iD>` | Save as contact |
| `/network/#groups?add=<ORCID iD>` | Add to group |
| `/network/?import=<ORCID iD>` | Follow (also for someone already saved as a contact or group member) |
| `/network/#contacts?add=<ORCID iD>` | **I just met people**, with the iD added to the list |
| `/network/?sample=1#groups` | The labelled sample, after a question |
| `/?orcid=<ORCID iD>&from=contacts` | Explore with the iD filled in and a way back (`from` can also be `people` or `groups`) |

An invalid iD is explained and never imported. If the researcher is already a contact, **Open their contact card** appears instead of a duplicate. If reading from ORCID fails, nothing is saved and the panel keeps what you typed, with **Retry** (a reload clears it). If the record was read but a later step failed, **Retry** reuses the stored record.
