import _ from 'lodash'
import React, {useState, useCallback, useMemo, useContext, useEffect, useRef, useLayoutEffect} from 'react'
import ReactDOM from 'react-dom'
import {Editor, EditorState, ContentState, Modifier, Entity, CompositeDecorator, getDefaultKeyBinding} from 'draft-js'
import data from './data.json'

import 'draft-js/dist/Draft.css'
import './index.css'

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
    _.filter(_.map(data.names, (name) => name + ' ' + name), (name) =>
      name.toLowerCase().startsWith(text.toLowerCase()))
    .slice(0, 4)
    .map((name, i) => {
      return {
        img: `https://placekitten.com/5${i}/5${i}`,
        text: '@' + name
      }
    })),
  REF: _.memoize((text) =>
    _.filter(data.refs, (ref) =>
      ref.toLowerCase().startsWith(text.toLowerCase()))
    .slice(0, 4)
    .map((ref) => {return {text: '<>' + ref}})),
}

const Autocomplete = ({text, results, onResult, events}) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    if (selectedIndex > results.length - 1) setSelectedIndex(0)
  }, [results.length])

  const onNext = useCallback(() => {
    setSelectedIndex((selectedIndex + 1) % results.length)
  }, [selectedIndex, setSelectedIndex, results])

  const onPrev = useCallback(() => {
    setSelectedIndex(selectedIndex === 0 ? results.length - 1 : selectedIndex - 1)
  }, [selectedIndex, setSelectedIndex, results])

  const onConfirm = useCallback(() => {
    onResult(results[selectedIndex])
  }, [onResult, selectedIndex, results])

  useEffect(() => {
    events.addEventListener('next', onNext)
    events.addEventListener('prev', onPrev)
    events.addEventListener('confirm', onConfirm)

    return () => {
      events.removeEventListener('next', onNext)
      events.removeEventListener('prev', onPrev)
      events.removeEventListener('confirm', onConfirm)
    }
  }, [events, onNext, onPrev, onResult])

  const ref = useRef(null)

  const setPosition = useCallback(() => {
    if (!ref.current) return
    const parentRect = ref.current.parentElement.getBoundingClientRect()
    const parentYOffset = parseFloat(getComputedStyle(ref.current.parentElement).fontSize) * 1.3
    const rect = ref.current.getBoundingClientRect()
    const x = Math.min(parentRect.x, window.innerWidth - rect.width)
    const y = parentRect.y + rect.height + parentYOffset > window.innerHeight ?
      parentRect.y - rect.height
      : parentRect.y + parentYOffset

    ref.current.style.transform = `translate(${x}px, ${y}px)`
  }, [ref])

  useLayoutEffect(() => {
    setPosition()
  })

  useEffect(() => {
    window.addEventListener('resize', setPosition)
    return () => window.removeEventListener('resize', setPosition)
  }, [setPosition])

  const resultItems = results.map((result, i) =>
    <div
      className={`result ${i === selectedIndex ? 'is-selected' : ''}`}
      key={i}
      onMouseOver={() => setSelectedIndex(i)}
      onClick={() => onResult(result)} >
      {result.img ? <img src={result.img} width="50" height="50" /> : null}
      <strong>{result.text.slice(0, text.length - 1)}</strong>
      {result.text.slice(text.length - 1)}
    </div>
  )

  return resultItems.length > 0 ?
      <div className="autocomplete" ref={ref}>{resultItems}</div>
      : null
}

const autocompleteEntityDecorator = (type) => {
  return {
    strategy: (contentBlock, callback, contentState) =>
      contentBlock.findEntityRanges((x) =>
        x.getEntity() && contentState.getEntity(x.getEntity()).getType() === type.key
      , callback),
    component: (props) => {
      if (!props.entityKey) return null

      const result = props.contentState.getEntity(props.entityKey).getData()
      const {entityKey, events} = useContext(AutocompleteContext)
      const isEntity = props.entityKey === entityKey

      useEffect(() => {
        if (props.decoratedText.indexOf(type.prefix) === -1 ||
            props.decoratedText.indexOf('\u2009') === -1 && !result.text) {
          events.dispatchEvent(new CustomEvent('remove', {
            detail: {
              start: props.start,
              end: props.end + 1,
              text: props.decoratedText
            }
          }))
        }
      }, [props, events])

      const results = genResults[type.key](
        props.decoratedText.replace(/^(#|@|<>)/, '').replace('\u2009', '')
      )

      const onResult = useCallback((result) => {
        events.dispatchEvent(new CustomEvent('finalize', {
          detail: {
            start: props.start,
            end: props.end,
            type: type,
            result: result ? result : {text: props.decoratedText.trim()}
          }
        }))
      }, [events, props])

      const onCancel = useCallback(() => onResult(), [onResult])

      useEffect(() => {
        if (!isEntity) return
        events.addEventListener('cancel', onCancel)

        return () => {
          events.removeEventListener('cancel', onCancel)
        }
      }, [isEntity, events, onCancel])

      return result.text ?
        <span className={`entity ${type.class}`} data-offset-key={props.offsetKey} contentEditable={false} >
          {result.text + '\u2009'}
        </span>
        : <span className={`entity ${type.class}`} data-offset-key={props.offsetKey} >
          {isEntity ?
            <Autocomplete
              text={props.decoratedText}
              results={results}
              onResult={onResult}
              events={events} />
            : null}
          {props.children}
        </span>
    }
  }
}

const compositeDecorator = new CompositeDecorator(
  AUTOCOMPLETE_TYPES.map(autocompleteEntityDecorator)
)

function MyEditor() {
  const [editorState, setEditorState] = useState(
    EditorState.createWithContent(
      ContentState.createFromText('by Zolmeister # @ <>'), compositeDecorator)
  )

  const createAutocompleteEntity = useCallback((type, start, end) => {
    let contentState = editorState.getCurrentContent()
    const selection = editorState.getSelection().merge({
      anchorOffset: start,
      focusOffset: end,
      isBackward: false
    })

    contentState = contentState.createEntity(type.key, 'MUTABLE')

    contentState = Modifier.replaceText(
      contentState,
      selection,
      // XXX: Keep cursor within entity with thin-space
      type.prefix + '\u2009',
      null,
      contentState.getLastCreatedEntityKey()
    )

    const newEditorState =
      EditorState.push(editorState, contentState, 'insert-autocomplete-entity')

    setEditorState(EditorState.forceSelection(newEditorState, selection.merge({
      anchorOffset: start + type.prefix.length,
      focusOffset: start + type.prefix.length
    })))
  })

  const autocompleteEvents = useMemo(() => new EventTarget(), [])
  const autocompleteEntityKey = useMemo(() => {
    const selection = editorState.getSelection()
    const anchorKey = selection.getAnchorKey()
    const anchorOffset = selection.getAnchorOffset()
    const block = editorState.getCurrentContent().getBlockForKey(anchorKey)
    const blockText = block.getText()
    const blockCharacterMetadata = block.getCharacterList()
    const meta = blockCharacterMetadata.get(anchorOffset)
    const prevMeta = blockCharacterMetadata.get(anchorOffset - 1)
    const isWithinEntity = meta && prevMeta && meta.getEntity() === prevMeta.getEntity()

    if (!prevMeta || !prevMeta.getEntity()) {
      AUTOCOMPLETE_TYPES.forEach((type) => {
        const start = anchorOffset - type.prefix.length
        const blockPrefix = blockText.slice(start, anchorOffset)
        if (blockPrefix === type.prefix) {
          createAutocompleteEntity(type, start, anchorOffset)
        }
      })
    }

    return isWithinEntity && meta.getEntity()
  }, [editorState])

  const onAutocompleteFinalize = useCallback((e) => {
    const {start, end, type, result} = e.detail

    let contentState = editorState.getCurrentContent()
    contentState = contentState.createEntity(type.key, 'IMMUTABLE', result)

    const selection = editorState.getSelection().merge({
      anchorOffset: start,
      focusOffset: end,
      isBackward: false
    })

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

    setEditorState(EditorState.push(editorState, contentState, 'replace-autocomplete-entity'))
  }, [editorState])

  const onAutocompleteRemove = useCallback((e) => {
    const {start, end, text} = e.detail

    let contentState = editorState.getCurrentContent()

    const entitySelection = editorState.getSelection().merge({
      anchorOffset: start,
      focusOffset: end,
      isBackward: false
    })

    const cursorSelection = entitySelection.merge({
      anchorOffset: start,
      focusOffset: start,
      isBackward: false
    })

    contentState = Modifier.removeRange(
      contentState,
      entitySelection,
      'forward'
    )

    contentState = Modifier.insertText(
      contentState,
      cursorSelection,
      text
    )

    let newEditorState = EditorState.push(editorState, contentState, 'remove-autocomplete-entity')
    newEditorState = EditorState.forceSelection(newEditorState, cursorSelection)

    setEditorState(newEditorState)
  }, [editorState])

  useEffect(() => {
    autocompleteEvents.addEventListener('finalize', onAutocompleteFinalize)
    autocompleteEvents.addEventListener('remove', onAutocompleteRemove)
    return () => {
      autocompleteEvents.removeEventListener('finalize', onAutocompleteFinalize)
      autocompleteEvents.removeEventListener('remove', onAutocompleteRemove)
    }
  }, [autocompleteEvents, onAutocompleteFinalize, onAutocompleteRemove])

  const keyBindingsFn = useCallback((e: SyntheticKeyboardEvent): string => {
    const isCompleting = Boolean(autocompleteEntityKey)
    const isHashtag = autocompleteEntityKey &&
      editorState.getCurrentContent().getEntity(autocompleteEntityKey).getType() === 'HASH'

    if (isCompleting && e.keyCode === 38) { // UP
      return 'autocomplete-prev'
    }

    if (isCompleting && e.keyCode === 40) { // DOWN
      return 'autocomplete-next'
    }

    if (isCompleting && (e.keyCode === 9 || e.keyCode === 13)) { // TAB, ENTER
      return 'autocomplete-confirm'
    }

    if (isCompleting && (e.keyCode === 27 || isHashtag && e.keyCode === 32)) { // ESC, SPACE
      return 'autocomplete-cancel'
    }

    return getDefaultKeyBinding(e)
  }, [autocompleteEntityKey, editorState])

  const handleKeyCommand = useCallback((command: string) => {
    switch (command) {
      case 'autocomplete-next':
        autocompleteEvents.dispatchEvent(new CustomEvent('next'))
        break
      case 'autocomplete-prev':
        autocompleteEvents.dispatchEvent(new CustomEvent('prev'))
        break
      case 'autocomplete-confirm':
        autocompleteEvents.dispatchEvent(new CustomEvent('confirm'))
        break
      case 'autocomplete-cancel':
        autocompleteEvents.dispatchEvent(new CustomEvent('cancel'))
        break
      default:
        return 'not-handled'
    }

    return 'handled'
  }, [autocompleteEvents])

  return <div>
    <AutocompleteContext.Provider value={{
        entityKey: autocompleteEntityKey,
        events: autocompleteEvents
      }}>
      <Editor
        editorState={editorState}
        onChange={setEditorState}
        keyBindingFn={keyBindingsFn}
        handleKeyCommand={handleKeyCommand} />
    </AutocompleteContext.Provider>
  </div>
}

ReactDOM.render(<MyEditor />, document.getElementById('container'))
