import { describe, expect, it } from 'vitest'
import { assignPositions, cellKey, moveGroup, sortItems, gridDims, pxToCell } from './layout'

const dims = { cols: 4, rows: 3 }

describe('assignPositions', () => {
  it('flows new items column-major from the top-left', () => {
    const pos = assignPositions(['a', 'b', 'c', 'd'], {}, dims, false)
    expect(pos).toEqual({ a: { col: 0, row: 0 }, b: { col: 0, row: 1 }, c: { col: 0, row: 2 }, d: { col: 1, row: 0 } })
  })

  it('keeps saved positions and fills gaps around them', () => {
    const pos = assignPositions(['a', 'b'], { b: { col: 0, row: 0 } }, dims, false)
    expect(pos.b).toEqual({ col: 0, row: 0 })
    expect(pos.a).toEqual({ col: 0, row: 1 })
  })

  it('drops out-of-bounds and duplicate saved cells', () => {
    const pos = assignPositions(['a', 'b', 'c'], { a: { col: 9, row: 9 }, b: { col: 1, row: 1 }, c: { col: 1, row: 1 } }, dims, false)
    const keys = Object.values(pos).map(cellKey)
    expect(new Set(keys).size).toBe(3)
    expect(pos.b).toEqual({ col: 1, row: 1 })
  })

  it('ignores saved positions when auto-arranging', () => {
    const pos = assignPositions(['a', 'b'], { a: { col: 3, row: 2 } }, dims, true)
    expect(pos.a).toEqual({ col: 0, row: 0 })
  })

  it('never loses icons when the grid is full', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `i${i}`)
    const pos = assignPositions(ids, {}, dims, false)
    expect(Object.keys(pos)).toHaveLength(20)
    expect(new Set(Object.values(pos).map(cellKey)).size).toBe(20)
  })
})

describe('moveGroup', () => {
  it('moves a selection by a delta, keeping its shape', () => {
    const pos = { a: { col: 0, row: 0 }, b: { col: 0, row: 1 }, c: { col: 3, row: 2 } }
    const next = moveGroup(pos, ['a', 'b'], { col: 1, row: 0 }, dims)
    expect(next.a).toEqual({ col: 1, row: 0 })
    expect(next.b).toEqual({ col: 1, row: 1 })
    expect(next.c).toEqual({ col: 3, row: 2 })
  })

  it('bumps a dropped icon off an occupied cell instead of stacking', () => {
    const pos = { a: { col: 0, row: 0 }, b: { col: 1, row: 0 } }
    const next = moveGroup(pos, ['a'], { col: 1, row: 0 }, dims)
    expect(next.b).toEqual({ col: 1, row: 0 })
    expect(cellKey(next.a)).not.toBe(cellKey(next.b))
  })

  it('clamps at the grid edge', () => {
    const next = moveGroup({ a: { col: 3, row: 2 } }, ['a'], { col: 5, row: 5 }, dims)
    expect(next.a).toEqual({ col: 3, row: 2 })
  })
})

describe('sortItems', () => {
  const base = { extension: '', modifiedMs: 0, sizeBytes: 0 }
  it('puts folders first and sorts names naturally', () => {
    const out = sortItems(
      [
        { ...base, id: '1', name: 'file10', isDir: false },
        { ...base, id: '2', name: 'file2', isDir: false },
        { ...base, id: '3', name: 'zeta', isDir: true },
      ],
      'name',
    )
    expect(out.map((i) => i.name)).toEqual(['zeta', 'file2', 'file10'])
  })
})

describe('geometry', () => {
  it('computes grid size and snaps pixels to cells', () => {
    const d = gridDims(1920, 1000, 'medium')
    expect(d.cols).toBe(21)
    expect(d.rows).toBe(9)
    expect(pxToCell(105, 115, 'medium', d)).toEqual({ col: 1, row: 1 })
    expect(pxToCell(-500, -500, 'medium', d)).toEqual({ col: 0, row: 0 })
  })
})
