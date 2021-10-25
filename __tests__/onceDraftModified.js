import {
	setUseProxies,
	setAutoFreeze,
	enableAllPlugins,
	onceDraftModified,
	current,
	immerable,
	isDraft,
	produce,
	original,
	createDraft
} from "../src/immer"

enableAllPlugins()

runTests("proxy", true)
runTests("es5", false)

const isProd = process.env.NODE_ENV === "production"

function runTests(name, useProxies) {
	describe("onceDraftModified - " + name, () => {
		if (!useProxies) {
			it.skip("es5 not supported yet", () => {})
			return
		}

		const callback = jest.fn()

		beforeAll(() => {
			setAutoFreeze(true)
			setUseProxies(useProxies)
		})

		beforeEach(() => {
			callback.mockReset()
		})

		it("must be called on draft", () => {
			expect(() => {
				onceDraftModified({}, callback)
			}).toThrowError(
				isProd
					? "[Immer] minified error nr: 22 '[object Object]'. Find the full error at: https://bit.ly/3cXEKWf"
					: "[Immer] 'current' expects a draft, got: [object Object]"
			)
		})

		it("can trigger on objects", () => {
			const base = {a: 1234}
			const draft = createDraft(base)

			callback.mockImplementation(iDraft => {
				expect(iDraft).toBe(draft)
			})

			onceDraftModified(draft, callback)
			expect(callback).toBeCalledTimes(0)

			draft.a = 5678 // trigger!
			expect(callback).toBeCalledTimes(1)

			draft.a = 9999 // no trigger because already modified once.
			expect(callback).toBeCalledTimes(1)

			onceDraftModified(draft, callback) // trigger immediately because draft has already been modified
			expect(callback).toBeCalledTimes(2)

			draft.a = 333 // no trigger because already modified once.
			expect(callback).toBeCalledTimes(2)
		})

		it("can trigger on nested objects", () => {
			const base = {a: {x: {y: 1234}}}
			const draft = createDraft(base)

			callback.mockImplementation(iDraft => {
				expect(iDraft).toBe(draft)
			})

			onceDraftModified(draft, callback)
			expect(callback).toBeCalledTimes(0)

			draft.a.x.y = 5678 // trigger!
			expect(callback).toBeCalledTimes(1)

			draft.a.x.y = 9999 // no trigger because already modified once.
			expect(callback).toBeCalledTimes(1)

			onceDraftModified(draft, callback) // trigger immediately because draft has already been modified
			expect(callback).toBeCalledTimes(2)

			draft.a.x.y = 333 // no trigger because already modified once.
			expect(callback).toBeCalledTimes(2)
		})

		it("can trigger on arrays", () => {
			const base = [1, 2, 3]
			const draft = createDraft(base)

			callback.mockImplementation(iDraft => {
				expect(iDraft).toBe(draft)
			})

			onceDraftModified(draft, callback)
			expect(callback).toBeCalledTimes(0)

			draft.push(5678) // trigger!
			expect(callback).toBeCalledTimes(1)

			draft.push(9999) // no trigger because already modified once.
			expect(callback).toBeCalledTimes(1)

			onceDraftModified(draft, callback) // trigger immediately because draft has already been modified
			expect(callback).toBeCalledTimes(2)

			draft.push(333) // no trigger because already modified once.
			expect(callback).toBeCalledTimes(2)
		})
	})
}
