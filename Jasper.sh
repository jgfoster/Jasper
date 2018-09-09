topaz -l << EOF
iferr 1 stk
iferr 2 output pop
iferr 3 stk
iferr 4 abort
iferr 5 logout
iferr 6 exit
errorCount
output push WebGS.out only
input WebGS.gs
input JSON.gs
output pop
errorCount
output push Jasper.out only
input JasperGlobals.gs
output pop
errorCount
commit
iferr 1 stk
iferr 2 exit
send Jasper run
EOF
