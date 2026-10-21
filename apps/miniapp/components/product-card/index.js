import { withTapFeedback } from '../../utils/tap-feedback';
Component(withTapFeedback({
  properties: {
    product: {
      type: Object,
      value: {},
    },
  },

  methods: {
    openProduct() {
      if (!this.data.product?.slug) return;
      this.triggerEvent('select', { slug: this.data.product.slug });
    },
  },
}, ["openProduct"], {"component":true}));
