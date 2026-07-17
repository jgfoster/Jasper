Feature: Loading a Rowan project into a database

  On disk a project is only a definition. Loading it installs the project's
  packages, classes and methods into a running GemStone database, where the
  code can actually run — and Jasper then lists it among the projects that
  database knows about.

  @fixture:demo-library
  Scenario: Loading the open project into a database
    Given the demo-library Rowan project is open
    And I am logged in to a database
    When I load the project into the database
    Then DemoLibrary is listed among the loaded projects
