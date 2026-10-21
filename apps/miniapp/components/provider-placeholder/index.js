Component({ properties: { show: Boolean }, methods: { explain() { wx.showToast({ title: "请先配置自己的平台插件", icon: "none" }); } } });
