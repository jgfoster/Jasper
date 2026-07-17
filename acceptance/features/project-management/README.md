# Project Management

A Rowan "project" is what everyone else calls a **package** — a named unit of
code that declares which packages exist, which classes and methods belong to
each, and which other projects it depends on, all as plain files you can read,
diff, review and commit. Managing one is mostly managing those files and their
dependencies.

Jasper treats that on-disk definition as the source of truth. Open a folder that
is a project and the editor reads it directly: no stone, no login, no running
image required. Loading a project into a database is a separate, deliberate act.
Version control of your own project is VS Code's job — Jasper doesn't replace
it; the only git Jasper drives itself is fetching the projects you depend on.

## How the pieces fit

A project is rooted at a `rowan/project.ston` file. Beside it sit the
[STON](https://github.com/GemTalk/Rowan) specifications that name the project,
list its components, and record its dependencies; packages themselves live under
`src/` in [Tonel](https://github.com/pharo-vcs/tonel) format, one directory per
package.

Everything below was captured from a real editor window driving a real project.
Each chapter follows one task from the first click to the result, so what you see
is what the product does — not a description of what it is meant to do.
