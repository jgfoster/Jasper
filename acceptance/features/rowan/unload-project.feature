Feature: Removing a Rowan project from a database

  A project loaded into a database can be taken out again, leaving the database
  as it was and the project untouched on disk.

  @fixture:demo-library
  Scenario: Unloading a project from a database
    Given the demo-library Rowan project is open
    And I am logged in to a database
    And I load the project into the database
    When I unload the project from the database
    Then DemoLibrary is no longer among the loaded projects
