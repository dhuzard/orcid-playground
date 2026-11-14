# Get started — no installation

{{ brand }} has two paths. Pick the task you came for; each takes a few minutes and needs no account.

| Path | You end with | Steps | Start |
| --- | --- | --- | --- |
| **Explore & Play** | A record-quality report and a citation file for one public record | about 4 | [Explore](https://science-record-player.web.app/) |
| **Connect & Organize** | A sample workspace with a contact note and a curated group, exported as a team pack | about 5 | [My Network with sample data](https://science-record-player.web.app/network/?sample=1#groups) |

## Explore & Play: one record, many outputs

1. Open [Explore](https://science-record-player.web.app/).
2. Choose **The maintainer's profile (stored, offline)**. This stored example makes no public ORCID request. To use your own record instead, paste your 16-character ORCID iD (or record URL) and select **Explore**; that reads the public record from `pub.orcid.org`. No sign-in is needed.
3. Open **Record check**. Use its suggestions to decide which changes to make **in ORCID**: this tool never modifies your record. Missing works or affiliations may be non-public, absent or out of date.
4. Open **Citations & data** and download a **BibTeX** or **JSON-LD** file.
5. Optional: open **Heatmap** or **Wrapped** and compare its summary with the public record.

**Where the data is:** computed in your browser; downloads are saved on your device. See [Studio](studio.md) for every tab.

## Connect & Organize: people and groups

1. Open [My Network with sample data](https://science-record-player.web.app/network/?sample=1#groups) and confirm the prompt. Nothing is added until you confirm. Sample people and outputs are labelled **Demo** and must not be cited as real scientific records.
2. The sample adds people and a group but no contacts yet. Open **People**, select **+** on a Demo person and, under **Tag**, type a context such as a conference name and choose **Add tag**: that makes them a contact. Then open **Contacts** and add a note and a follow-up with a due date. With real people, use **I just met people** in Contacts: paste ORCID iDs, name the context and choose **Import & tag**.
3. Open **Groups** and the demonstration group. Inspect its roster and locally entered roles, choose project outputs and look at its requests.
4. Open **Team pack** and download it. A team pack does not contain Contacts notes.
5. Optional: visit [Public Group View](https://science-record-player.web.app/group/) to compose a shareable link from real public ORCID iDs. The link contains only a group name and the iDs, never your notes, local roles or selected outputs.

**Where the data is:** My Network is stored in this browser profile only. If you start keeping real notes, download a **workspace backup** from time to time, and keep it private: it contains your notes. See [My Network](research-network.md) and [Public Group View](groups.md).

## Moving between the paths

With the guided journeys from #56 ([PR #66](https://github.com/dhuzard/science-record-player/pull/66), not yet checked on the live site):

- Under a profile in Explore, **Keep this researcher in My Network** offers **Save as contact**, **Add to group** or **Follow**. Each opens My Network with the iD filled in and asks before anything is read from ORCID or saved.
- On contact, person and group-member cards in My Network, **Open in Explore →** opens the same record in Explore, which waits for you to press **Explore** and offers **← Back to My Network**.
- My Network's **Guide** walks through the seven Connect & Organize steps; **Remove sample data** takes the labelled sample out again.

The [five-minute tutorials](tutorials.md) follow this route step by step.

## What to try next

- [Explore all Studio outputs](studio.md).
- [Use My Network and Contacts](research-network.md).
- [Compare Public Group View with your own laboratory or consortium](groups.md).
- [Tell us what is confusing or missing](feedback.md).

**Reminder:** {{ disclaimer }} Public-record content is not identity or affiliation verification.
