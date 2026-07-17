Feature: Seeing where a dependency stands

  A dependency is a file on disk before it is anything else. The project view
  lists each one beside the packages it belongs with, and because the record is
  an ordinary file, adding one shows up as an ordinary change to commit. Adding
  it does not put the code in the database, so while you are connected Jasper
  offers to load — and remembers your answer if you want it to.

  Scenario: Adding a dependency to a committed project
    Given a committed Rowan project is open
    When I open the This Project view
    And I add a local directory as a dependency
    Then SharedKit is listed as a dependency
    When I review what has changed
    Then SharedKit's reference is waiting to be committed
    When I commit them with a message
    Then nothing is left to commit

  @fixture:demo-library
  Scenario: Being offered the load, and declining it
    Given the demo-library Rowan project is open
    And I am logged in to a database
    When I open the This Project view
    And I add a local directory as a dependency
    Then Jasper offers to load the project
    When I decline the offer
    Then SharedKit is listed as not loaded

  @fixture:demo-library
  Scenario: Answering never, and not being asked again
    Given the demo-library Rowan project is open
    And I am logged in to a database
    When I open the This Project view
    And I add a local directory as a dependency
    And I answer never to the offer
    And I add a git repository as a dependency
    Then Toolkit is added without another offer
