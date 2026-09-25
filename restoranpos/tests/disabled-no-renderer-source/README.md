# Not run: these need renderer source this tree does not have

`gate`, `money` and `period` test helper functions that live in
`apps/desktop/src/renderer/lib/`. That directory is part of the Vite source
tree, and this checkout ships the renderer as a built bundle
(`index-DAmHwBc4.js`) instead — so the modules they import cannot resolve and
the files failed on every run.

They are parked here rather than deleted: the tests themselves are fine, and the
moment the renderer source is in this tree again they can go straight back into
`tests/unit/` unchanged.

Rewriting them against the bundle was considered and rejected: it would mean
re-implementing the helpers next to the bundle that already contains them, which
is two sources of truth for the same arithmetic — exactly the kind of drift a
money test exists to prevent.

`no-native-dialogs.test.ts` did move to the bundle, because it checks a property
of the shipped artefact (no native dialogs anywhere) rather than the behaviour
of a function.
