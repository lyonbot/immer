import {ProxyArrayState, prepareCopy, markChanged} from "./proxy"

type ProxiedArrayMutator<T extends keyof any[]> = (
	proxiedArray: any[],
	indexes: number[],
	state: ProxyArrayState
) => any[][T]
type ArrayMutatorName =
	| "shift"
	| "unshift"
	| "push"
	| "pop"
	| "splice"
	| "sort"
	| "reverse"

const arrayMutators: {
	[k in ArrayMutatorName]: ProxiedArrayMutator<k>
} = {
	push: (array, indexes, state) => (...items) => {
		indexes.push(...items.map(x => -1))
		return array.push(...items)
	},
	pop: (array, indexes) => () => {
		indexes.pop()
		return array.pop()
	},
	unshift: (array, indexes, state) => (...items) => {
		indexes.unshift(...items.map(x => -1))
		return array.unshift(...items)
	},
	shift: (array, indexes) => () => {
		indexes.shift()
		return array.shift()
	},
	splice: (array, indexes, state) => (
		index = 0,
		deleteCount = array.length - index,
		...items: any[]
	) => {
		indexes.splice(index, deleteCount, ...items.map(x => -1))
		return array.splice(index, deleteCount, ...items)
	},
	reverse: (array, indexes) => () => {
		indexes.reverse()
		return array.reverse()
	},
	sort: (array, indexes) => (compareFn = defaultArrayCompareFn) => {
		indexes.sort((ai, bi) => compareFn(array[ai], array[bi]))
		const oldItems = array.slice()
		indexes.forEach((oi, ni) => {
			array[ni] = oldItems[oi]
		})
		return array
	}
}

const defaultArrayCompareFn = (x: any, y: any) => {
	//INFO: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
	//ECMA specification: http://www.ecma-international.org/ecma-262/6.0/#sec-sortcompare
	if (x === undefined && y === undefined) return 0

	if (x === undefined) return 1

	if (y === undefined) return -1

	const xString = String(x)
	const yString = String(y)

	if (xString < yString) return -1

	if (xString > yString) return 1

	return 0
}

export function getProxiedArrayMutator(
	state: ProxyArrayState,
	prop: string,
	draft: any
) {
	// if the proxied mutator is invoking,
	// `getProxiedArrayMutator` might be called again and we shall return the original method
	if (state.isMutatingArray_) return null

	if (!Object.hasOwnProperty.call(arrayMutators, prop)) return null

	// hijack regular array mutating functions
	const fnFactory = arrayMutators[prop as ArrayMutatorName]
	return (...args: any[]) => {
		prepareCopy(state)
		markChanged(state)
		try {
			state.isMutatingArray_ = true
			const fn = fnFactory(draft, state.oldIndexes_, state) as any
			return fn(...args)
		} finally {
			state.isMutatingArray_ = false
		}
	}
}
