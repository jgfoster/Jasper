! Load the native GemStone MCP server classes, in dependency order.
! Run from an already-logged-in topaz session:  topaz> input load.gs
! (or use install.sh, which logs in, runs this, and commits).

input GsMcpTool.gs
input GsMcpToolRegistry.gs
input GsMcpHttpConnection.gs
input GsMcpDispatcher.gs
input GsMcpServer.gs

! Unit-test classes (GsTestCase subclasses) + their mock transport.
input GsMcpMockSocket.gs
input GsMcpToolTest.gs
input GsMcpDispatcherTest.gs
input GsMcpTransportTest.gs

commit
