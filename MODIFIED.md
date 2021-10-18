# What's Modified

This is a fork of [immerjs/immer](https://github.com/immerjs/immer), with these changes:

## Patches of Array Operations

In the original version, array operations yield lots of patches:

```js
// code from original version's testcase
runPatchTest(
	{x: [1, 2, 3]},
	d => {
		d.x.unshift(4)
	},
	[
		{op: "replace", path: ["x", 0], value: 4},
		{op: "replace", path: ["x", 1], value: 1},
		{op: "replace", path: ["x", 2], value: 2},
		{op: "add", path: ["x", 3], value: 3}
	]
)
```

This is quiet tedious. We introduces a new `op` called `arrayOp`. The case above is now:

```js
// code from original version's testcase
runPatchTest(
	{x: [1, 2, 3]},
	d => {
		d.x.unshift(4)
	},
	[
		{op: "resortArray", path: ["x"], indexes: [-1, 0, 1, 2]},
		{op: "replace", path: ["x", 0], value: 4}
	]
)
```

All mutations to an array, can become

The following array operations is handled:

- shift / unshift
- push / pop
- splice
- sort
- reverse
