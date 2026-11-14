# Frequently asked questions

## Do I need to sign in to try the tool?

No. You can examine the stored demonstration profile or enter any public ORCID iD directly. Optional ORCID sign-in exposes personal controls; it is not needed for public-record exploration.

## Will it edit my ORCID record?

No. The public exploration and exports read ORCID records; they do not write information back to ORCID.

## Is my ORCID record independently verified?

No. The public API exposes assertions and visibility settings; the application cannot treat a valid iD or a public entry as conclusive verification of qualifications, affiliations or publication authorship.

## Does the group graph prove who collaborated?

No. A link means both public records list the same DOI: a co-assertion of one output, not independent collaboration evidence. A real collaboration may be absent if metadata are incomplete, and a shared DOI does not prove project membership or contribution roles.

## Is a funder-format biosketch ready to submit?

No. NIH, ERC and Horizon exports are **drafts**, built from available asserted data. Validate the content and the current funder's requirements before submitting.

## What happens when I am offline?

The installed web app can reopen cached assets after an initial visit. Stored sample material and a locally saved network can remain usable. Fetching a new public ORCID record still requires network access.

## Are my research contacts visible to other people?

In the hosted Research network, tags, notes, and follow-ups are browser-local. They are not invitations and do not notify the named researchers. Take care with workspace backup files, which can contain these notes.

## Is there a private cloud team workspace?

Not on the public site. The codebase contains invite-based cloud Teams, but they are experimental and **not available**: no production test or security review has been recorded. Follow the [availability and trust notes](trust.md).

## What is the difference between a Group, a Public Group View link and a Team?

- A **local curated Group** lives in My Network, in your browser. Its roster, roles and project outputs are your own annotations; the people listed are not asked or notified.
- A **Public Group View link** contains only a group name and public ORCID iDs. Anyone you send it to can open it.
- A **private cloud Team** would be an invite-only shared workspace. It is not available.

None of these implies that the people listed accepted membership.

## Is it free/open source?

The application source is [MIT licensed](https://github.com/dhuzard/science-record-player/blob/main/LICENSE). Public ORCID data remain subject to their own applicable terms. This project is independent of ORCID, Inc.

## How can I suggest improvements without writing software?

Try the [five-minute test](feedback.md), then use the [in-app feedback form](https://science-record-player.web.app/feedback/), which needs no GitHub account. Describe the scientific task, the expected result and what should change. GitHub issues remain available for developers.
