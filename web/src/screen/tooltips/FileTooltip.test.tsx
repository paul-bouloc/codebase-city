import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FileTooltip } from './FileTooltip'

const PATH = 'src/vs/editor/common/model/textModel.ts'
const LONG_PATH = 'src/vs/workbench/contrib/terminal/browser/terminalInstanceService.ts'

const file = (path: string, withRole: boolean) =>
  renderToStaticMarkup(
    <FileTooltip
      path={path}
      language="typescript"
      lines={2481}
      complexity={412}
      complexityTop={1}
      incoming={1204}
      outgoing={38}
      fileRole={withRole ? 'conductor' : undefined}
      pointer={{ x: 100, y: 100 }}
    />,
  )

describe('FileTooltip', () => {
  it('is a tooltip with the facts of the file', () => {
    const html = file(PATH, true)
    expect(html).toContain('role="tooltip"')
    expect(html).toContain('TypeScript · 2,481 lines · complexity 412')
    expect(html).toContain('(top 1%)')
    expect(html).toContain('Imported by 1,204 files')
    expect(html).toContain('imports 38')
  })

  it('names a language the city does not paint in its own colour', () => {
    const html = renderToStaticMarkup(
      <FileTooltip
        path="app/main.py"
        language="other"
        languageName="Python"
        lines={120}
        complexity={9}
        incoming={0}
        outgoing={3}
        pointer={{ x: 0, y: 0 }}
      />,
    )
    expect(html).toContain('Python · 120 lines · complexity 9')
  })

  it('shows the role badge, always likely, only for a file with a role', () => {
    expect(file(PATH, true)).toContain('Conductor · likely')
    expect(file(PATH, false)).not.toContain('Conductor')
  })

  it('shortens the folder from its start but reads the whole path', () => {
    const html = file(LONG_PATH, false)
    expect(html).toContain(`<span class="visually-hidden">${LONG_PATH}</span>`)
    expect(html).toContain('>…/terminal/browser/</span>')
    expect(html).toContain('>terminalInstanceService.ts</span>')
  })

  it('stays hidden until it is measured and placed', () => {
    expect(file(PATH, false)).toContain('visibility:hidden')
  })
})
