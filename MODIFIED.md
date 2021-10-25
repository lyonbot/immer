# What's Modified

This is a fork of [immerjs/immer](https://github.com/immerjs/immer), with these changes:

## `onceDraftModified`

This package exports the `onceDraftModified` method. Once a draft and its **(deeply) nested** draft has been modified, callbacks will be called.

If the draft is already modified, the callback will be called immediately.

```js
const draft = createDraft({a: 1234})
const callback = iDraft => {
	console.log("modified", iDraft) // iDraft is always draft
}

onceDraftModified(draft, callback)

draft.a = 5678 // trigger!

draft.a = 9999 // no trigger because already modified once.

onceDraftModified(draft, callback) // trigger immediately because draft has already been modified

draft.a = 333 // no trigger because already modified once.
```

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

This is quiet tedious. We introduces a new `op` called `resortArray`. The case above is now:

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

In this example:

1. `resortArray` will resize and reorder the array with `indexes`. The first slot of array is set to empty and the rest reuses existing elements.
2. `replace` will fill the empty slots made by `resortArray`.

### Supported methods

The following array operations are handled:

- shift / unshift
- push / pop
- splice
- sort
- reverse

NOTE: ES5 is not supported yet.

### More Complex Example

If the array contains object, the algorithm will reuse existing elements as much as possible:

```js
const base = {
	x: [{id: 1}, {id: 2}, {id: 3}]
}

const producer = d => {
	d.x[2] = {id: 999}
	d.x[1].extra = 123

	// move the first element to last, and add a property to it
	const temp = d.x.shift()
	d.x.push(temp)
	temp.ext2 = "yes"

	// insert another object to the beginning
	d.x.unshift({id: 0})
}

const result = {
	x: [{id: 0}, {id: 2, extra: 123}, {id: 999}, {id: 1, ext2: "yes"}]
}

const patches = [
	// first of all, modify the existing elements
	{op: "add", path: ["x", 1, "extra"], value: 123},
	{op: "add", path: ["x", 0, "ext2"], value: "yes"}, // later, this element will be move to the end

	// then we resort the Array and fill the holes
	{op: "resortArray", path: ["x"], indexes: [-1, 1, -1, 0]},
	{op: "replace", path: ["x", 0], value: {id: 0}},
	{op: "replace", path: ["x", 2], value: {id: 999}}
]
const inversePatches = [
	// in inversePatches, we resortArray at first
	{op: "resortArray", path: ["x"], indexes: [3, 1, -1]},
	{op: "replace", path: ["x", 2], value: {id: 3}},

	// then revert the changes to reused elements
	{op: "remove", path: ["x", 1, "extra"]},
	{op: "remove", path: ["x", 0, "ext2"]}
]
```
