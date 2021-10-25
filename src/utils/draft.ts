import {ProxyObjectState, ProxyArrayState, DRAFT_STATE} from "../internal"
import {die} from "./errors"

export function getDraftState(value: any): ProxyObjectState | ProxyArrayState {
	let state = !!value && value[DRAFT_STATE]
	if (!state) die(22, value)
	return state
}

export function onceDraftModified<T = any>(x: T, callback: (draft: T) => void) {
	const state = getDraftState(x)

	if (state.modified_) {
		callback(x)
		return
	}

	const allCallbacks =
		state.onModifiedCallbacks_ || (state.onModifiedCallbacks_ = new Set())
	allCallbacks.add(callback)
}
