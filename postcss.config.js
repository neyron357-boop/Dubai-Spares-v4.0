import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';

// Tailwind 3 emitted layers in order without native CSS layer priority.
// Keep that cascade and sibling spacing while updating the maintained compiler.
const legacyLayerCascade = {
  postcssPlugin: 'legacy-layer-cascade',
  OnceExit(root) {
    root.walkAtRules('layer', (rule) => {
      if (rule.nodes) rule.replaceWith(rule.nodes);
      else rule.remove();
    });
    root.walkRules((rule) => {
      const match = /^:where\((\.space-y-[^ ]+) > :not\(:last-child\)\)$/.exec(rule.selector);
      if (!match) return;
      rule.selector = `${match[1]} > :not([hidden]) ~ :not([hidden])`;
      const start = rule.nodes.find((node) => node.prop === 'margin-block-start');
      const end = rule.nodes.find((node) => node.prop === 'margin-block-end');
      if (!start || !end) return;
      const startValue = start.value;
      start.prop = 'margin-top';
      start.value = end.value;
      end.prop = 'margin-bottom';
      end.value = startValue;
    });
  },
};

export default {
  plugins: [tailwindcss(), legacyLayerCascade, autoprefixer()],
};
