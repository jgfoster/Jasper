Feature: Adding a dependency to a Rowan project

  A Rowan dependency is another project. From an open project you add one by
  pasting a local directory (or a git URL); Jasper writes the reference to disk.

  @fixture:demo-library
  Scenario: Adding a dependency from a local directory
    Given the demo-library Rowan project is open
    When I add a local directory as a dependency
    Then the project lists SharedKit alongside its own package

  @fixture:demo-library
  Scenario: Pinning a dependency to a released version
    A dependency on a git repository has to say which revision to use, so Jasper
    reads the repository's branches and tags and asks you to choose one.

    Given the demo-library Rowan project is open
    When I add a git repository as a dependency
    Then the project lists Toolkit alongside its own package
