import _ from 'lodash'
import React, {useState, useCallback, useMemo, useContext, useEffect} from 'react'
import ReactDOM from 'react-dom'
import {Editor, EditorState, ContentState, Modifier, Entity, CompositeDecorator, getDefaultKeyBinding} from 'draft-js'
import data from './data.json'

import 'draft-js/dist/Draft.css'
import './index.css'

const AUTOCOMPLETE_REGEX = /(^|\s)(#|@|<>)(\S*)/g
const AUTOCOMPLETE_TYPES = [
  {
    key: 'HASH',
    prefix: '#',
    class: 'hash'
  },
  {
    key: 'PERSON',
    prefix: '@',
    class: 'person'
  },
  {
    key: 'REF',
    prefix: '<>',
    class: 'ref'
  }
]
const AUTOCOMPLETE_KEY_TO_TYPE = _.keyBy(AUTOCOMPLETE_TYPES, 'key')
const AUTOCOMPLETE_PREFIX_TO_TYPE = _.keyBy(AUTOCOMPLETE_TYPES, 'prefix')

const AutocompleteContext = React.createContext({})
const genResults = {
  HASH: _.memoize((text) =>
    _.filter(data.hashtags, (tag) =>
      tag.toLowerCase().startsWith('#' + text.toLowerCase()))
    .slice(0, 4)
    .map((tag) => {return {text: tag}})),
  PERSON: _.memoize((text) =>
    _.filter(data.names, (name) =>
      name.toLowerCase().startsWith(text.toLowerCase()))
    .slice(0, 4)
    .map((name, i) => {
      return {
        img: `https://placekitten.com/5${i}/5${i}`,
        text: ' ' + name
      }
    })),
  REF: _.memoize((text) =>
    _.filter(_.map(data.refs, (ref) => ref.replace(/ /g, '_')), (ref) =>
      ref.toLowerCase().startsWith(text.toLowerCase()))
    .slice(0, 4)
    .map((ref) => {return {text: '<>' + ref}})),
}

function autocompleteStrategy(contentBlock, callback, contentState) {
  findWithRegex(AUTOCOMPLETE_REGEX, contentBlock, callback)
}

// https://github.com/facebook/draft-js/blob/master/examples/draft-0-10-0/tweet/tweet.html
function findWithRegex(regex, contentBlock, callback) {
  const text = contentBlock.getText()
  let matchArr, start
  while ((matchArr = regex.exec(text)) !== null) {
    start = matchArr.index
    callback(start, start + matchArr[0].length)
  }
}

const Autocomplete = (props) => {
  const autocomplete = useContext(AutocompleteContext)
  const shouldShow = autocomplete &&
    autocomplete.blockKey === props.blockKey &&
    autocomplete.start >= props.start &&
    autocomplete.start <= props.end

  const resultItems = shouldShow ? autocomplete.results.map((result, i) =>
    <div
      className={`result ${i === autocomplete.selectedIndex ? 'is-selected' : ''}`}
      key={i}
      onMouseOver={() => autocomplete.setSelectedIndex(i)}
      onClick={() =>
        autocomplete.commitResult(autocomplete.type.key, result, autocomplete.start, autocomplete.end)}>
      {result.img ? <img src={result.img} width="50" height="50" /> : null}
      <strong>{result.text.slice(0, autocomplete.matched.length)}</strong>
      {result.text.slice(autocomplete.matched.length)}
    </div>
  ) : []

  return <span className="autocompletable" data-offset-key={props.offsetKey}>
    {resultItems.length > 0 ? <div className="autocomplete">
      {resultItems}
    </div> : null}
    {props.children}
  </span>
}

const autocompleteEntityDecorator = (type) => {
  return {
    strategy: (contentBlock, callback, contentState) =>
      contentBlock.findEntityRanges((x) =>
        x.getEntity() && contentState.getEntity(x.getEntity()).getType() === type.key
      , callback),
    component: (props) => {
      const result = props.contentState.getEntity(props.entityKey).getData()

      return <span className={`entity ${type.class}`} data-offset-key={props.offsetKey} contentEditable={false}>
        {result.img ? <img src={result.img} width="50" height="50" /> : null}
        {result.text}
      </span>
    }
  }
}

const compositeDecorator = new CompositeDecorator(
  AUTOCOMPLETE_TYPES.map(autocompleteEntityDecorator)
  .concat([{
    strategy: autocompleteStrategy,
    component: Autocomplete
  }])
)

function MyEditor() {
  const [editorState, setEditorState] = useState(
    EditorState.createWithContent(
      ContentState.createFromText('by Zolmeister #dog @Bob <>Miami'), compositeDecorator)
  )

  const commitResult = useCallback((entityType, result, start, end) => {
    let contentState = editorState.getCurrentContent()
    const selection = editorState.getSelection().merge({
      anchorOffset: start,
      focusOffset: end,
      isBackward: false
    })

    contentState = contentState.createEntity(
      entityType,
      'IMMUTABLE',
      result
    )

    contentState = Modifier.replaceText(
      contentState,
      selection,
      result.text,
      null,
      contentState.getLastCreatedEntityKey()
    )

    contentState = Modifier.insertText(
      contentState,
      contentState.getSelectionAfter(),
      ' '
    )

    setEditorState(EditorState.push(editorState, contentState, 'insert-autocomplete-entity'))
  }, [editorState, setEditorState, autocompleteState])

  const [autocompleteIndex, setAutocompleteIndex] = useState(0)
  const autocompleteState = useMemo(() => {
    const selection = editorState.getSelection()
    const anchorKey = selection.getAnchorKey()
    const anchorOffset = selection.getAnchorOffset()
    const block = editorState.getCurrentContent().getBlockForKey(anchorKey)
    const blockText = block.getText()
    const blockCharacterMetadata = block.getCharacterList()

    let i = anchorOffset
    while (--i > 0) {
      const meta = blockCharacterMetadata.get(i)
      if (meta && Boolean(meta.getEntity())) return null
      if (/\s/.test(blockText[i])) {
        i += 1
        break
      }
    }

    const match = [...blockText.slice(i, anchorOffset).matchAll(AUTOCOMPLETE_REGEX)]
    if (match.length === 0) return null
    const type = AUTOCOMPLETE_PREFIX_TO_TYPE[match[0][2]]
    const text = match[0][3]

    return {
      start: i,
      end: anchorOffset,
      type: type,
      text: text,
      matched: match[0][0],
      results: genResults[type.key](text),
      selectedIndex: autocompleteIndex,
      setSelectedIndex: setAutocompleteIndex,
      blockKey: anchorKey,
      commitResult: commitResult
    }
  }, [editorState, autocompleteIndex, setAutocompleteIndex, commitResult])

  useEffect(() => {
    setAutocompleteIndex(0)
  }, [autocompleteState && autocompleteState.results, setAutocompleteIndex])

  const keyBindingsFn = useCallback((e: SyntheticKeyboardEvent): string => {
    const isCompleting = Boolean(autocompleteState)
    if (isCompleting && e.keyCode === 38) { // UP
      return 'autocomplete-prev'
    }

    if (isCompleting && e.keyCode === 40) { // DOWN
      return 'autocomplete-next'
    }

    if (isCompleting && (e.keyCode === 9 || e.keyCode === 13)) { // TAB, ENTER
      return 'autocomplete-commit'
    }

    return getDefaultKeyBinding(e)
  }, [autocompleteState])

  const handleKeyCommand = useCallback((command: string) => {
    if (command === 'autocomplete-next') {
      setAutocompleteIndex((autocompleteIndex + 1) % autocompleteState.results.length)
      return 'handled'
    }

    if (command === 'autocomplete-prev') {
      setAutocompleteIndex(autocompleteIndex === 0 ? autocompleteState.results.length - 1 : autocompleteIndex - 1)
      return 'handled'
    }

    if (command === 'autocomplete-commit') {
      const {type, results, start, end} = autocompleteState
      autocompleteState.commitResult(type.key, results[autocompleteIndex], start, end)
      return 'handled'
    }

    return 'not-handled'
  }, [autocompleteIndex, setAutocompleteIndex, autocompleteState])

  return <div>
    <AutocompleteContext.Provider value={autocompleteState}>
      <Editor
        editorState={editorState}
        onChange={setEditorState}
        keyBindingFn={keyBindingsFn}
        handleKeyCommand={handleKeyCommand} />
    </AutocompleteContext.Provider>
  </div>
}

ReactDOM.render(<MyEditor />, document.getElementById('container'))
