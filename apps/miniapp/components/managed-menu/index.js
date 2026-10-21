import { withTapFeedback } from '../../utils/tap-feedback';
import { fetchPublishedLayout } from '../../services/content';
import { navigateToManagedPage } from '../../utils/navigation';

Component(withTapFeedback({
  properties: {
    activePageKey: {
      type: String,
      value: '',
    },
  },

  data: {
    items: [],
  },

  lifetimes: {
    attached() {
      this.loadMenu();
    },
  },

  methods: {
    async loadMenu() {
      try {
        const layout = await fetchPublishedLayout('header');
        const items = layout.document?.documentType === 'header' && Array.isArray(layout.document.items)
          ? layout.document.items.filter((item) => item?.label && item?.pageKey)
          : [];
        this.setData({ items });
      } catch (_error) {
        this.setData({ items: [] });
      }
    },

    selectItem(event) {
      const link = {
        pageKey: event.currentTarget.dataset.pageKey,
        query: event.currentTarget.dataset.query,
      };
      if (link.pageKey === this.properties.activePageKey && String(link.query || '').startsWith('#')) {
        this.triggerEvent('anchor', { query: link.query });
        return;
      }
      navigateToManagedPage(link);
    },
  },
}, ["selectItem"], {"component":true}));
