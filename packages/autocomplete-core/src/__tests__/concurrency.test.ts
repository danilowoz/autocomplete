import userEvent from '@testing-library/user-event';

import { AutocompleteState } from '..';
import { createSource, defer } from '../../../../test/utils';
import { createAutocomplete } from '../createAutocomplete';

type Item = {
  label: string;
};

describe('concurrency', () => {
  test('resolves the responses in order from getSources', async () => {
    // These delays make the second query come back after the third one.
    const sourcesDelays = [100, 150, 200];
    const itemsDelays = [0, 150, 0];
    let deferSourcesCount = -1;
    let deferItemsCount = -1;

    const getSources = ({ query }) => {
      deferSourcesCount++;

      return defer(() => {
        return [
          createSource({
            getItems() {
              deferItemsCount++;

              return defer(
                () => [{ label: query }],
                itemsDelays[deferItemsCount]
              );
            },
          }),
        ];
      }, sourcesDelays[deferSourcesCount]);
    };
    const onStateChange = jest.fn();
    const autocomplete = createAutocomplete({ getSources, onStateChange });
    const { onChange } = autocomplete.getInputProps({ inputElement: null });
    const input = document.createElement('input');
    input.addEventListener('input', onChange);
    document.body.appendChild(input);

    userEvent.type(input, 'a');
    userEvent.type(input, 'b');
    userEvent.type(input, 'c');

    const timeout = Math.max(
      ...sourcesDelays.map((delay, index) => delay + itemsDelays[index])
    );

    await defer(() => {}, timeout);

    let stateHistory: Array<
      AutocompleteState<Item>
    > = onStateChange.mock.calls.flatMap((x) => x[0].state);

    const itemsHistory: Item[] = stateHistory.flatMap(({ collections }) =>
      collections.flatMap((x) => x.items)
    );

    // The first query should have brought results.
    expect(itemsHistory.find((x) => x.label === 'a')).toBeDefined();
    // The second query should never have brought results.
    expect(itemsHistory.find((x) => x.label === 'ab')).toBeUndefined();

    // The last item must be the one corresponding to the last query.
    expect(itemsHistory[itemsHistory.length - 1]).toEqual(
      expect.objectContaining({ label: 'abc' })
    );

    expect(stateHistory[stateHistory.length - 1]).toEqual(
      expect.objectContaining({ isOpen: true })
    );

    userEvent.type(input, '{backspace}'.repeat(3));

    await defer(() => {}, timeout);

    stateHistory = onStateChange.mock.calls.flatMap((x) => x[0].state);

    // The collections are empty despite late resolving promises.
    expect(stateHistory[stateHistory.length - 1].collections).toEqual([
      expect.objectContaining({ items: [] }),
    ]);

    // The panel closes despite late resolving promises.
    expect(stateHistory[stateHistory.length - 1]).toEqual(
      expect.objectContaining({ isOpen: false })
    );

    document.body.removeChild(input);
  });
});
