Feature: Depending on WebGS

  A real dependency, fetched from a real repository over the network. WebGS is
  the GemStone web-server engine, and a project that depends on it pins the
  exact commit it was built against — a branch moves, so naming one is not
  really pinning.

  This chapter needs the internet, so it is skipped unless JASPER_ONLINE_SPECS
  is set; the routine suite stays offline and fast.

  @fixture:demo-library @online
  Scenario: Pinning WebGS to an exact commit
    Given the demo-library Rowan project is open
    When I open the This Project view
    And I add WebGS as a dependency, pinned to a commit
    Then WebGS is listed as a dependency
    And WebGS records the commit it was pinned to
