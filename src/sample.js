// The sample the compiler demo shows: the build compiles it with
// ren-core/esbuild's `compile` and ships input and output as sources.

export const SAMPLE = `import { $signal, $read, $write } from 'rrx-core';
import { $active, For } from 'ren-core';

export function Todo(props) {
  const R = $active();
  const done = $signal(R, false);
  return (
    <li class="todo" title="click to toggle">
      <input type="checkbox" checked={done} onChange={() => $write(done, !$read(done))} />
      <span class={() => ($read(done) ? 'done' : '')}>{props.text}</span>
      <small>static text is part of the template</small>
    </li>
  );
}

export const List = props => <ul class="todos"><For each={props.items}>{item => <Todo text={item()} />}</For></ul>;
`;
