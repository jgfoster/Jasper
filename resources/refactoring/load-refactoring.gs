! ============================================================================
! Thin bootstrap for loading the Jasper refactoring engine into a stone.
!
! Run this under topaz in a SystemUser session on a LOCAL stone (the gem must be
! able to read this directory). It files in the loader class, then asks the
! loader to do the real work -- create the dedicated GsRefactoring dictionary,
! file in the AST substrate, feature-detected compat backports, and engine, run
! a post-load completeness check, and commit on success (abort on failure).
!
! Everything else lives in GsRefactoringLoader, so the human path and the Jasper
! client path share one load mechanism. See LOADING.md for the full runbook.
!
! BEFORE RUNNING: replace every <PAYLOAD_DIR> below with the absolute server-side
! path to this directory, e.g.
!   /export/.../Jasper/resources/refactoring
! (In topaz:  edit  or your editor's find-and-replace -- there are two.)
! ============================================================================

input <PAYLOAD_DIR>/refactoring-loader.gs

run
| ldr |
ldr := GsRefactoringLoader loadFromServerDir: '<PAYLOAD_DIR>'.
ldr reportString displayNl.
(ldr allOk ifTrue: ['[GsRefactoring] Committed.']
	ifFalse: ['[GsRefactoring] Aborted -- nothing was committed.']) displayNl.
%
