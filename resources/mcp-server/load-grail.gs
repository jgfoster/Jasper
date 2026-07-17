! Load the base MCP server classes AND the optional GemStone-Python (Grail) tools.
! Only valid on an image that has Grail/ModuleAst installed.
! Run from an already-logged-in topaz session:  topaz> input load-grail.gs
! (or use `GS_MCP_WITH_GRAIL=1 ./install.sh`, or `./install.sh --grail`).

! Base classes + base test suites (loads GsMcpServer before its subclass).
input load.gs

! Optional Grail subclass + its test suite (must load after GsMcpServer / the base tests).
input GsMcpServerWithGrail.gs
input GsMcpServerWithGrailTest.gs

commit
