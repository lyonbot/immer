import {
	each,
	has,
	is,
	isDraftable,
	shallowCopy,
	latest,
	ImmerBaseState,
	ImmerState,
	Drafted,
	AnyObject,
	AnyArray,
	Objectish,
	getCurrentScope,
	DRAFT_STATE,
	die,
	createProxy,
	ProxyType
} from "../internal"
import {getProxiedArrayMutator} from "./proxied-array-mutator"

interface ProxyBaseState extends ImmerBaseState {
	assigned_: {
		[property: string]: boolean
	}
	parent_?: ImmerState
	revoke_(): void
}

export interface ProxyObjectState extends ProxyBaseState {
	type_: ProxyType.ProxyObject
	base_: any
	copy_: any
	draft_: Drafted<AnyObject, ProxyObjectState>
}

export interface ProxyArrayState extends ProxyBaseState {
	type_: ProxyType.ProxyArray
	base_: AnyArray
	copy_: AnyArray | null
	draft_: Drafted<AnyArray, ProxyArrayState>
	isMutatingArray_: boolean // true if an array mutation is in progress
	oldIndexes_: number[]
}

type ProxyState = ProxyObjectState | ProxyArrayState

/**
 * Returns a new draft of the `base` object.
 *
 * The second argument is the parent draft-state (used internally).
 */
export function createProxyProxy<T extends Objectish>(
	base: T,
	parent?: ImmerState
): Drafted<T, ProxyState> {
	const isArray = Array.isArray(base)
	const state: ProxyState = {
		type_: isArray ? ProxyType.ProxyArray : (ProxyType.ProxyObject as any),
		// Track which produce call this is associated with.
		scope_: parent ? parent.scope_ : getCurrentScope()!,
		// True for both shallow and deep changes.
		modified_: false,
		// Used during finalization.
		finalized_: false,
		// Track which properties have been assigned (true) or deleted (false).
		assigned_: {},
		// Track each item's old indexes. Will be reset to -1 if assigned / spliced
		oldIndexes_: isArray
			? Array.from({length: (base as any[]).length}, (_, i) => i)
			: undefined,
		// The parent draft state.
		parent_: parent,
		// The base state.
		base_: base,
		// The base proxy.
		draft_: null as any, // set below
		// The base copy with any updated values.
		copy_: null,
		// Called by the `produce` function.
		revoke_: null as any,
		isManual_: false
	}

	// the traps must target something, a bit like the 'real' base.
	// but also, we need to be able to determine from the target what the relevant state is
	// (to avoid creating traps per instance to capture the state in closure,
	// and to avoid creating weird hidden properties as well)
	// So the trick is to use 'state' as the actual 'target'! (and make sure we intercept everything)
	// Note that in the case of an array, we put the state in an array to have better Reflect defaults ootb
	let target: T = state as any
	let traps: ProxyHandler<object | Array<any>> = objectTraps
	if (isArray) {
		target = [state] as any
		traps = arrayTraps
	}

	const {revoke, proxy} = Proxy.revocable(target, traps)
	state.draft_ = proxy as any
	state.revoke_ = revoke
	return proxy as any
}

/**
 * Object drafts
 */
export const objectTraps: ProxyHandler<ProxyState> = {
	get(state, prop) {
		if (prop === DRAFT_STATE) return state

		const source = latest(state)
		if (!has(source, prop)) {
			// non-existing or non-own property...
			return readPropFromProto(state, source, prop)
		}
		const value = source[prop]
		if (state.finalized_ || !isDraftable(value)) {
			return value
		}
		// Check for existing draft in modified state.
		// Assigned values are never drafted. This catches any drafts we created, too.
		if (value === peek(state.base_, prop)) {
			prepareCopy(state)
			return (state.copy_![prop as any] = createProxy(
				state.scope_.immer_,
				value,
				state
			))
		}
		return value
	},
	has(state, prop) {
		return prop in latest(state)
	},
	ownKeys(state) {
		return Reflect.ownKeys(latest(state))
	},
	set(
		state: ProxyObjectState,
		prop: string /* strictly not, but helps TS */,
		value
	) {
		const desc = getDescriptorFromProto(latest(state), prop)
		if (desc?.set) {
			// special case: if this write is captured by a setter, we have
			// to trigger it with the correct context
			desc.set.call(state.draft_, value)
			return true
		}
		if (!state.modified_) {
			// the last check is because we need to be able to distinguish setting a non-existing to undefined (which is a change)
			// from setting an existing property with value undefined to undefined (which is not a change)
			const current = peek(latest(state), prop)
			// special case, if we assigning the original value to a draft, we can ignore the assignment
			const currentState: ProxyObjectState = current?.[DRAFT_STATE]
			if (currentState && currentState.base_ === value) {
				state.copy_![prop] = value
				state.assigned_[prop] = false
				return true
			}
			if (is(value, current) && (value !== undefined || has(state.base_, prop)))
				return true
			prepareCopy(state)
			markChanged(state)
		}

		if (
			state.copy_![prop] === value &&
			// special case: NaN
			typeof value !== "number" &&
			// special case: handle new props with value 'undefined'
			(value !== undefined || prop in state.copy_)
		)
			return true

		// @ts-ignore
		state.copy_![prop] = value
		state.assigned_[prop] = true
		return true
	},
	deleteProperty(state, prop: string) {
		// The `undefined` check is a fast path for pre-existing keys.
		if (peek(state.base_, prop) !== undefined || prop in state.base_) {
			state.assigned_[prop] = false
			prepareCopy(state)
			markChanged(state)
		} else {
			// if an originally not assigned property was deleted
			delete state.assigned_[prop]
		}
		// @ts-ignore
		if (state.copy_) delete state.copy_[prop]
		return true
	},
	// Note: We never coerce `desc.value` into an Immer draft, because we can't make
	// the same guarantee in ES5 mode.
	getOwnPropertyDescriptor(state, prop) {
		const owner = latest(state)
		const desc = Reflect.getOwnPropertyDescriptor(owner, prop)
		if (!desc) return desc
		return {
			writable: true,
			configurable: state.type_ !== ProxyType.ProxyArray || prop !== "length",
			enumerable: desc.enumerable,
			value: owner[prop]
		}
	},
	defineProperty() {
		die(11)
	},
	getPrototypeOf(state) {
		return Object.getPrototypeOf(state.base_)
	},
	setPrototypeOf() {
		die(12)
	}
}

/**
 * Array drafts
 */

const arrayTraps: ProxyHandler<[ProxyArrayState]> = {}
each(objectTraps, (key, fn) => {
	// @ts-ignore
	arrayTraps[key] = function() {
		arguments[0] = arguments[0][0]
		return fn.apply(this, arguments)
	}
})
arrayTraps.get = function(state, prop, draft) {
	let proxiedMutator =
		typeof prop === "string" && getProxiedArrayMutator(state[0], prop, draft)
	if (proxiedMutator) return proxiedMutator

	return objectTraps.get!.call(this, state[0], prop, draft)
}
arrayTraps.deleteProperty = function(state, prop) {
	if (__DEV__ && isNaN(parseInt(prop as any))) die(13)
	return objectTraps.deleteProperty!.call(this, state[0], prop)
}
arrayTraps.set = function(state, prop, value) {
	const propIsNum = !isNaN(parseInt(prop as any))
	if (__DEV__ && prop !== "length" && !propIsNum) die(14)
	if (!state[0].isMutatingArray_) {
		const oldIndexes = state[0]!.oldIndexes_
		// for array, the proxied mutator should update oldIndexes_
		// but if user is directly assigning, we reset item's oldIndex
		if (propIsNum) {
			const index = Number(prop)
			while (oldIndexes.length <= index) oldIndexes.push(-1)
			oldIndexes[index] = -1
		} else if (prop === "length") {
			// array length changed
			if (value < oldIndexes.length) oldIndexes.splice(value)
			if (value > oldIndexes.length)
				oldIndexes.push(
					...Array.from({length: value - oldIndexes.length}, () => -1)
				)
		}
	}
	return objectTraps.set!.call(this, state[0], prop, value, state[0])
}

// Access a property without creating an Immer draft.
function peek(draft: Drafted, prop: PropertyKey) {
	const state = draft[DRAFT_STATE]
	const source = state ? latest(state) : draft
	return source[prop]
}

function readPropFromProto(state: ImmerState, source: any, prop: PropertyKey) {
	const desc = getDescriptorFromProto(source, prop)
	return desc
		? `value` in desc
			? desc.value
			: // This is a very special case, if the prop is a getter defined by the
			  // prototype, we should invoke it with the draft as context!
			  desc.get?.call(state.draft_)
		: undefined
}

function getDescriptorFromProto(
	source: any,
	prop: PropertyKey
): PropertyDescriptor | undefined {
	// 'in' checks proto!
	if (!(prop in source)) return undefined
	let proto = Object.getPrototypeOf(source)
	while (proto) {
		const desc = Object.getOwnPropertyDescriptor(proto, prop)
		if (desc) return desc
		proto = Object.getPrototypeOf(proto)
	}
	return undefined
}

export function markChanged(state: ImmerState) {
	if (!state.modified_) {
		state.modified_ = true
		if (state.parent_) {
			markChanged(state.parent_)
		}

		if (state.onModifiedCallbacks_) {
			state.onModifiedCallbacks_.forEach(fn => fn(state.draft_))
			state.onModifiedCallbacks_ = void 0
		}
	}
}

export function prepareCopy(state: {base_: any; copy_: any}) {
	if (!state.copy_) {
		state.copy_ = shallowCopy(state.base_)
	}
}
