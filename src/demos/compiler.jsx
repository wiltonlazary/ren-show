// The template compiler (ren-core/esbuild): intrinsic element trees become plans
// hoisted once per module and cloned per instance; only dynamic parts run.

import { $signal, $read, $write, $lookup } from 'rrx-core';
import { $active, Action, Layout } from 'ren-core';
import { Assets } from '../assets.js';
import { Block, Value } from '../kit.jsx';

function View() {
  const R = $active();
  const env = $lookup(Assets);
  const which = $signal(R, 'output');
  const input = env.sources['compiler:input'] ?? '(the build adds the sample)';
  const output = env.sources['compiler:output'] ?? '(the build adds the compiled sample)';
  return (
    <div class="demo">
      <Block title="This page" note="ren-show ships two bundles of the same source: one compiled by the ren-core/esbuild plugin (the default) and one built with the automatic JSX runtime (add ?runtime to the URL). Both render the same DOM.">
        <p class="values">
          <Value label="this bundle" value={env.mode === 'compiled' ? 'compiled templates (ren-core/esbuild)' : 'automatic runtime (ren-core/jsx-runtime)'} />
        </p>
      </Block>
      <Block title="What the compiler does" note="Static structure (tags, text and literal attributes) becomes a plan, made once per module. Each evaluation only collects the values of the dynamic parts, in source order. Components, spreads and children stay as factory calls.">
        <Layout layout="row" gap={8}>
          <Action text="Input" selected={() => $read(which) === 'input'} onPress={() => $write(which, 'input')} />
          <Action text="Compiled output" selected={() => $read(which) === 'output'} onPress={() => $write(which, 'output')} />
        </Layout>
        <pre class="code">{() => ($read(which) === 'input' ? input : output)}</pre>
      </Block>
    </div>
  );
}

export default {
  id: 'compiler',
  group: 'ren-core',
  title: 'Template compiler',
  apis: ['ren-core/esbuild', 'compile', 'transform', 'jsx-runtime'],
  summary: 'The esbuild plugin turns each tree of intrinsic elements into a cloned template. The DOM host clones its own copy per document, and the Skia and worker hosts build the same nodes through their Host calls.',
  View,
};
