Feature: Loading into a database

  On disk a project is only a definition. Loading it installs the project's
  packages, classes and methods into a running GemStone database, where the code
  can actually run — and Jasper lists it among the projects that database knows
  about. A loaded project can be taken out again, leaving the database as it was
  and the project untouched on disk.

  @fixture:demo-library
  Scenario: Load the open project
    Given the demo-library Rowan project is open
    And I am logged in to a database
    When I load the project into the database
    Then DemoLibrary is listed among the loaded projects

  @fixture:demo-library
  Scenario: Unload a project
    Given the demo-library Rowan project is open
    And I am logged in to a database
    And I load the project into the database
    When I unload the project from the database
    Then DemoLibrary is no longer among the loaded projects
