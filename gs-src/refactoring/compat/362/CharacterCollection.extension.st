"
GemStone/S 3.6.2 compatibility shim for the vendored RowanV3 AST-Core.

The AST (RBParser/RBScanner) assumes kernel convenience methods that exist in
the GemStone 3.7.x base image but are absent on 3.6.2. Each method here is
copied verbatim from the GemStone 3.7.5 kernel (product upgrade/sourcestrings.obj)
so behavior matches the 3.7.x base exactly. This package must be loaded ONLY on
stones that lack these methods (feature-detected) — on 3.7.5+ they already exist
and re-defining them would shadow the base-image versions.
"
Extension { #name : 'CharacterCollection' }

{ #category : '*ast-core-compat-362' }
CharacterCollection >> readStreamPortable [

	^ReadStreamPortable on: self
]
