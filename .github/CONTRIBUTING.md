# Contributing to LinkedIn Focus

Thanks for taking the time to look at this.

## Before anything else: what to expect

LinkedIn Focus is in maintenance mode. It is a small side project that does
what it was built to do. It is not abandoned: it gets touched when something
breaks badly enough or when an incoming change is worth the time. But no time
is reserved for it.

Read that literally:

- There is no weekly time budget for this project.
- There is no service level agreement, no promised response time and no
  guarantee that an issue or pull request gets a reply at all.
- Deliberately, no number is given here. A made-up "typically two weeks" would
  read as a commitment and would not be one.

This is a planning basis, not an excuse, and not a judgement about your
contribution. Silence means no attention was available, not rejection.

If you need a reaction within a defined window, do not wait for one here. Fork
it. The MIT licence exists precisely for that, the codebase is a handful of
plain files with no build step, and a fork is a legitimate outcome rather than
a failure.

A single polite comment on a thread that has gone quiet is always welcome.

## Where things belong

- **Bug reports and confirmed defects:** [Issues](https://github.com/jjarndt/linkedin-focus/issues), via the bug form.
- **Feature ideas:** Issues, via the feature form. Please read the README first
  and check that the idea is inside what this extension is meant to do.
- **Questions, "how do I", "is this supposed to work like this", setup and
  signing help:** [Discussions](https://github.com/jjarndt/linkedin-focus/discussions).
- **Security problems:** never in a public issue. See [SECURITY.md](SECURITY.md).

Support questions opened as issues will be converted to a discussion. This is
not a brush-off. Support questions have no natural end state, and when they sit
in the tracker they crowd out defects that do.

## Reporting a bug

LinkedIn is behind a login and its DOM changes without notice, so nobody can
hand you a public URL that reproduces a broken selector. The substitute is the
extension's own debug output. Before filing, enable it in the browser console
on `linkedin.com`:

```js
localStorage.setItem('lfDebug', '1');
```

Then reload the page and copy the `[LinkedIn Focus]` lines from the console
into the report. Those lines say what matched and why, and they are the closest
thing to a reproducer this project has. Add the outer HTML of the element that
should have been hidden, or that was hidden and should not have been, with
anything personal stripped out.

A report without that output usually cannot be acted on, because reconstructing
the page state moves the entire investigation to the receiving end.

## Proposing a change

Open an issue before writing code, for anything beyond a small fix. This is not
bureaucracy: it is the point at which a change can be declined cheaply, before
you have spent an evening on it.

Two questions decide whether a change is accepted:

1. Is it inside the scope described in the README? The extension hides feed,
   ads, the news and games rail, and notification badges, on LinkedIn, in
   Safari on macOS, with four toggles and no options beyond them.
2. Is the ongoing maintenance cost proportionate to the benefit?

In maintenance mode the second question dominates. A merged pull request
transfers maintenance of that code permanently to a project with no time
budget. A change can be good, well written, and still be declined because
carrying it is not sustainable here. New toggles, new options, other browsers
and other sites all fall on the expensive side of that line.

Declined does not mean the idea was bad. It usually means it belongs in a fork.

## Development setup

The extension itself has no build step: `extension/` contains plain
WebExtension files. Node is needed only for the test harness.

```sh
npm install
```

```sh
npm test
```

That runs the jsdom-based suite under `test/` with `node --test`. CI runs the
same suite on every pull request, so a green local run is a good predictor. If
either command fails on a clean checkout, that is a bug worth reporting on its
own.

To run the extension in Safari you have to wrap it in an app container with
Apple's converter and sign it with a free Apple ID. The exact
`xcrun safari-web-extension-converter` invocation and the Xcode signing steps
are in the [README](../README.md) under "Build" and "Signing & running". After
editing files in `extension/`, `./sync.sh` copies them into the generated
project's Resources directory, so resource-only changes need no rebuild.

## Pull requests

- One logical change per pull request. Small diffs get reviewed; large ones sit.
- Add a test that fails without your change. For a bug fix, that is a
  regression test. `test/harness.js` shows how to build a DOM fixture.
- Say in the description that you ran the extension in Safari against the real
  site, if the change touches selectors. The test suite works on fixtures and
  cannot tell you whether a selector still matches LinkedIn today.
- Keep unrelated reformatting out of functional pull requests. There is no
  formatter configured, so mixed diffs cannot be untangled mechanically and
  simply make review harder.
- Update the README in the same pull request as the behaviour it describes.

### Sign your commits (DCO)

This project uses the [Developer Certificate of Origin](https://developercertificate.org/),
not a contributor licence agreement. The DCO transfers no rights. It is a
statement that you have the right to submit the code under the project licence.

Sign off each commit:

```sh
git commit -s -m "fix: handle empty input"
```

That appends a `Signed-off-by` line using your git name and email. To fix an
existing branch:

```sh
git rebase --signoff main
```

There is no CI job checking this, so it is asked for rather than enforced. A
pull request without sign-off will be asked to add it before merge.

## AI-assisted contributions

Contributions written with AI assistance are allowed. Whether a patch was
written by hand or with model help does not change whether it solves the
problem, and a blanket ban would be neither enforceable nor fair. Three rules
apply.

**1. You must be able to explain the change.** Every line of it: why it was
made, what it solves, and why this way. If you cannot, the pull request will be
closed. Review answers you write yourself, not the model.

**2. Bug reports and fixes need evidence.** For this project that means the
`lfDebug` console output described above, plus the element that misbehaved.
Without it you push the verification work onto a project that has no time
budget for it. Unverified tool output presented as a finding will be closed
without a detailed reply.

**3. One AI-assisted pull request open at a time.** Volume is the actual
problem, not assistance. Generating a pull request has become cheap; reviewing
one has not, and here it is reviewed by one person in stolen time. If you have
one open, wait for it to be resolved before opening the next.

What leads to a close is never the suspicion that a model was involved, but
always demonstrably wrong content: invented APIs, selectors that match nothing,
reports that cannot be confirmed, changes the author cannot explain. Nobody is
judged on writing style here. Detection by "feel" misclassifies non-native
speakers systematically, so content is judged and provenance is not.

Effort is answered symmetrically. A report or pull request that clearly cost
its author no effort will not receive a detailed review in return.

## Good first issues

There is no curated list of starter issues, and pretending otherwise would set
up a promise this project cannot keep. If an open issue looks takeable and is
unassigned, take it, and say so on the thread so the work is not duplicated.

## Code of conduct

Be decent. Concretely: assume the other person is acting in good faith, keep
criticism about the code, and drop a thread rather than escalate it.

Reports go to the maintainer. Be aware of what that means for a project this
size: there is no committee, no separate investigator and no appeal. One person
receives the report and decides, and that person may be involved in the
conflict. That is a structural limitation, and it is stated here rather than
hidden behind a process that does not exist.
