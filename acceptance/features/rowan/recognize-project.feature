Feature: Recognizing a Rowan project

  Open a folder that is already a Rowan project and Jasper reads it from disk —
  no stone required — and lists its packages in the This Project view.

  @fixture:demo-library
  Scenario: Listing an open project's packages
    Given the demo-library Rowan project is open
    When I open the This Project view
    Then it lists the DemoLibrary-Core package
