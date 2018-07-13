<template>
  <i class="fa" :class="className" aria-hidden="true"></i>
</template>

<script>
export default {

  props: {
    icon: {
      type: String,
      required: true,
    },
    size: String,
    rotate: [Number, String],
    flip: String,
    pull: String,
    fixed: {
      type: Boolean,
      default: false,
    },
    border: {
      type: Boolean,
      default: false,
    },
    spin: {
      type: Boolean,
      default: false,
    },
    pulse: {
      type: Boolean,
      default: false,
    },
    inverse: {
      type: Boolean,
      default: false,
    },
  },

  name: 'icon',

  computed: {
    className() {
      const classes = ['fa-' + this.icon];
      if (this.size) {
        classes.push('fa-' + this.size);
      }
      if (this.fixed) {
        classes.push('fa-fw');
      }
      if (this.border) {
        classes.push('fa-border');
      }
      if (this.spin) {
        classes.push('fa-spin');
      }
      if (this.pulse) {
        classes.push('fa-pulse');
      }
      if (this.inverse) {
        classes.push('fa-inverse');
      }
      if (this.rotate) {
        classes.push('fa-rotate-' + this.rotate);
      }
      if (this.flip) {
        classes.push('fa-flip-' + this.flip);
      }
      if (this.pull) {
        classes.push('fa-pull-' + this.pull);
      }
      return classes;
    }
  }
};
</script>
