# Rowan

Rowan is the package and project manager for [GemStone/S 64 Bit](https://gemtalksystems.com/products/gs64/).
It gives Smalltalk code something Smalltalk has historically lacked: a definition
on disk. A Rowan project says which packages exist, which classes and methods
belong to each, and which other projects it depends on — all as plain files you
can read, diff, review and commit like any other source.

Jasper treats that on-disk definition as the source of truth. Open a folder that
is a Rowan project and the editor reads it directly: no stone, no login, no
running image required. Loading a project into a database is a separate,
deliberate act.

## What you can do

- **Start a project.** Turn an empty folder into a Rowan project — Jasper writes
  the `rowan/` metadata and a first component, so there is something real to
  commit before a line of Smalltalk exists.
- **Work in an existing one.** Open a project someone else wrote and browse its
  packages straight from the Tonel source on disk.
- **Depend on other projects.** Point a project at another one by git URL or by a
  directory on your machine, and Jasper records the reference in the project's
  component.
- **Load it into a stone.** Once a database is connected, load the project into
  the image and commit changes back out to disk.

## How the pieces fit

A project is rooted at a `rowan/project.ston` file. Beside it sit the
[STON](https://github.com/GemTalk/Rowan) specifications that name the project,
list its components, and record its dependencies; packages themselves live under
`src/` in [Tonel](https://github.com/pharo-vcs/tonel) format, one directory per
package.

Everything below was captured from a real editor window driving a real project.
Each chapter follows one task from the first click to the result, so what you see
is what the product does — not a description of what it is meant to do.
