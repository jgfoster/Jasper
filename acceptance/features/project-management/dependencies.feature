Feature: Dependencies

  A Rowan "project" is what everyone else calls a package, so this is the heart
  of managing one: what it depends on. A dependency is another project — named
  by a local directory or a git repository, pinned to a commit or a released
  version — and the reference is an ordinary file on disk, so adding one is an
  ordinary change to commit. Adding it does not put the code in the database, so
  while you are connected Jasper offers to load, and remembers your answer.

  @fixture:demo-library
  Scenario: Depend on a local project
    Given the demo-library Rowan project is open
    When I add a local directory as a dependency
    Then the project lists SharedKit alongside its own package

  @fixture:demo-library @online
  Scenario: Depend on a Git project, pinned to a commit
    A branch moves, so naming one is not really pinning. WebGS is the GemStone
    web-server engine; a project that depends on it pins the exact commit it was
    built against. This chapter needs the internet, so it is skipped unless
    JASPER_ONLINE_SPECS is set.

    Given the demo-library Rowan project is open
    When I open the This Project view
    And I add WebGS as a dependency, pinned to a commit
    Then WebGS is listed as a dependency
    And WebGS records the commit it was pinned to

  @fixture:demo-library
  Scenario: Pin a dependency to a released version
    A dependency on a git repository has to say which revision to use, so Jasper
    reads the repository's branches and tags and asks you to choose one.

    Given the demo-library Rowan project is open
    When I add a git repository as a dependency
    Then the project lists Toolkit alongside its own package

  Scenario: See whether a dependency is committed and loaded
    Given a committed Rowan project is open
    When I open the This Project view
    And I add a local directory as a dependency
    Then SharedKit is listed as a dependency
    When I review what has changed
    Then SharedKit's reference is waiting to be committed
    When I commit them with a message
    Then nothing is left to commit

  @fixture:demo-library
  Scenario: Choose whether to load after adding — decline
    Given the demo-library Rowan project is open
    And I am logged in to a database
    When I open the This Project view
    And I add a local directory as a dependency
    Then Jasper offers to load the project
    When I decline the offer
    Then SharedKit is listed as not loaded

  @fixture:demo-library
  Scenario: Choose whether to load after adding — never
    Given the demo-library Rowan project is open
    And I am logged in to a database
    When I open the This Project view
    And I add a local directory as a dependency
    And I answer never to the offer
    And I add a git repository as a dependency
    Then Toolkit is added without another offer
