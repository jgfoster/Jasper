Feature: Creating a Rowan project

  You don't need a stone to start authoring. From an empty folder, one click
  turns it into a Rowan project on disk, and Jasper recognizes it.

  Scenario: Turning an empty folder into a Rowan project
    Given an empty folder is open in the Rowan view
    When I create a Rowan project
    Then the folder becomes a Rowan project
