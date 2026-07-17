Feature: Serving a web page from the database

  The whole point of putting code in a database is to run it. This is a Rowan
  project that depends on WebGS, GemStone's web-server engine: declare the
  dependency, load the project — which fetches WebGS too — then start the app
  in a gem of its own and look at it in the editor's own browser.

  The page prints today's date, and the test asserts on today's date, so it
  cannot pass against a stale image or a cached page.

  This chapter clones and loads a real project over the network, so it takes
  minutes and is skipped unless JASPER_ONLINE_SPECS is set.

  @fixture:web-demo @online
  Scenario: A hello world, served from its own gem
    Given the web-demo Rowan project is open
    And I am logged in to a database
    When I open the This Project view
    And I add WebGS as a dependency, pinned to a commit
    And I accept the offer to load
    Then WebGS is listed as loaded
    When I run the web app in a gem of its own
    And I open the app in the editor's browser
    Then the page shows today's date
