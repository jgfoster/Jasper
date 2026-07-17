Feature: Committing a project to git

  A Rowan project is files on disk, so it belongs in version control like any
  other source tree. Jasper doesn't replace VS Code's own git support: you put a
  project under version control and commit it exactly as you would anything else.

  Scenario: Putting a new project under version control
    Given an empty folder is open in the Rowan view
    When I create a Rowan project
    And I put the folder under version control
    Then the project's files are waiting to be committed
    When I commit them with a message
    Then nothing is left to commit
