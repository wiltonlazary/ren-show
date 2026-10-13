// Control flow: branches are built lazily when shown and owned by the
// branch, so switching away stops everything they made. A JSX element is a
// Lazy (its component and props, not yet run), so a compound component can
// read its parts before any of them runs.

import { $signal, $read, $write, $cleanup, $owner } from 'rrx-core';
import { $active, Lazy, Action, Label, Layout, Show, Choose, When, Render, Portal } from 'ren-core';
import { Journal, Lines, Block } from '../kit.jsx';

/**
 * One step of a Steps: its title is read by Steps; its children are its page.
 * @param {{ title: string, children?: any }} props
 */
export const Step = props => props.children;

/**
 * A stepper made of its Step children. Each child is a Lazy, a component
 * and its props not yet run: Steps reads every title for its bar and runs
 * only the chosen step, again each time it is chosen.
 * @param {{ children?: any }} props
 */
export function Steps(props) {
  const R = $active();
  const at = $signal(R, 0);
  const steps = [props.children].flat().filter(child => child instanceof Lazy && child.component === Step);
  return (
    <div class="stepper">
      <Layout layout="row" gap={6}>
        {steps.map((step, i) => (
          <Action text={`${i + 1}. ${step.props.title}`} selected={() => $read(at) === i} onPress={() => $write(at, i)} />
        ))}
      </Layout>
      {() => steps[$read(at)]}
      <Layout layout="row" gap={6}>
        <Action text="Back" onPress={() => $write(at, Math.max(0, $read(at) - 1))} />
        <Action text="Next" onPress={() => $write(at, Math.min(steps.length - 1, $read(at) + 1))} />
      </Layout>
    </div>
  );
}

function View() {
  const R = $active();
  const journal = Journal(R);
  const parts = Journal(R);
  /** A step's page, noting when it is built and stopped. @param {{ name: string, children?: any }} props */
  const Page = props => {
    parts.note(`built ${props.name}`);
    $cleanup(/** @type {any} */ ($owner(R)), () => parts.note(`stopped ${props.name}`));
    return props.children;
  };
  const note = journal.note;

  /** A component that notes when it is built and when its scope stops. @param {{ name: string, children?: any }} props */
  const Traced = props => {
    note(`built ${props.name}`);
    $cleanup(/** @type {any} */ ($owner(R)), () => note(`stopped ${props.name}`));
    return props.children;
  };

  const count = $signal(R, 0);
  const temperature = $signal(R, 18);
  const shapes = { Circle: () => <svg width="40" height="40"><circle class="shape-a" cx="20" cy="20" r="16" /></svg>, Square: () => <svg width="40" height="40"><rect class="shape-b" x="4" y="4" width="32" height="32" /></svg> };
  const pick = $signal(R, /** @type {'Circle' | 'Square' | 'em'} */ ('Circle'));
  const open = $signal(R, false);
  /** @type {import('rrx-core').Writable<any>} */
  const target = $signal(R, null);

  return (
    <div class="demo">
      <Block title="Show" note="The branch is built once the count is positive and stays while it remains so. The function child reads the value itself.">
        <Layout layout="row" gap={8}>
          <Action text="+1" onPress={() => $write(count, $read(count) + 1)} />
          <Action text="Reset" onPress={() => $write(count, 0)} />
        </Layout>
        <Show when={() => $read(count) > 0 && $read(count)} fallback={<Traced name="fallback"><p class="quiet">count is zero</p></Traced>}>
          {(/** @type {() => number} */ value) => (
            <Traced name="branch">
              <p>{() => `count is ${value()}`}</p>
            </Traced>
          )}
        </Show>
      </Block>
      <Block title="Choose and When" note="The first When whose condition holds is shown. The branch changes only when a different When comes first.">
        <Layout layout="row" gap={8}>
          <Action text="Colder" onPress={() => $write(temperature, $read(temperature) - 7)} />
          <Action text="Warmer" onPress={() => $write(temperature, $read(temperature) + 7)} />
          <Label text={() => `${$read(temperature)} °C`} />
        </Layout>
        <Choose fallback={<Traced name="mild"><p>mild</p></Traced>}>
          <When when={() => $read(temperature) <= 0}>
            <Traced name="freezing"><p>freezing</p></Traced>
          </When>
          <When when={() => $read(temperature) >= 30}>
            <Traced name="hot"><p>hot</p></Traced>
          </When>
        </Choose>
      </Block>
      <Block title="Render" note="The component or tag is chosen at run time.">
        <Layout layout="row" gap={8}>
          <Action text="Circle" selected={() => $read(pick) === 'Circle'} onPress={() => $write(pick, 'Circle')} />
          <Action text="Square" selected={() => $read(pick) === 'Square'} onPress={() => $write(pick, 'Square')} />
          <Action text="<em> tag" selected={() => $read(pick) === 'em'} onPress={() => $write(pick, 'em')} />
        </Layout>
        <div class="stage">
          <Render of={() => ($read(pick) === 'em' ? 'em' : shapes[/** @type {'Circle' | 'Square'} */ ($read(pick))])} children="an em element" />
        </div>
      </Block>
      <Block title="Portal" note="The toast renders into the target box below, outside this block's markup, and closes with its branch.">
        <Action text={() => ($read(open) ? 'Close the toast' : 'Open a toast')} onPress={() => $write(open, !$read(open))} />
        <div class="portal-target" ref={target} />
        <Show when={() => $read(open) && $read(target)}>
          {() => (
            <Portal into={$read(target)}>
              <Traced name="toast">
                <p class="toast">Hello from a portal</p>
              </Traced>
            </Portal>
          )}
        </Show>
      </Block>
      <Block title="Journal">
        <Lines of={journal.lines} />
      </Block>
      <Block title="Compound components: Lazy" note="Steps reads its Step children before any of them runs: each is a Lazy, its component and props. It takes the titles for its bar and runs only the chosen step; the others are never built.">
        <Steps>
          <Step title="Pick a hall">
            <Page name="hall"><p class="leg">Hall B, 120 seats.</p></Page>
          </Step>
          <Step title="Choose a date">
            <Page name="date"><p class="leg">Thursday evening.</p></Page>
          </Step>
          <Step title="Confirm">
            <Page name="confirm"><p class="leg">Hall B on Thursday evening: confirmed.</p></Page>
          </Step>
        </Steps>
        <Lines of={parts.lines} />
      </Block>
    </div>
  );
}

export default {
  id: 'flow',
  group: 'ren-core',
  title: 'Control flow',
  apis: ['Show', 'Choose', 'When', 'Render', 'Portal', 'Lazy'],
  summary: 'Branches are lazy: a branch that is never shown is never built. Each shown branch owns its own scope, and switching away stops it and runs its cleanups. An element is a Lazy until it is inserted, so a compound component reads its parts first.',
  View,
};
