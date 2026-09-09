(function(root) {
  'use strict';
  function deleteProject(storage, id) {
    var projects = JSON.parse(storage.getItem('srt_projects') || '[]');
    if (!Array.isArray(projects)) throw new Error('项目列表无法读取');
    if (!projects.some(function(p) { return p.id === id; })) return false;
    var updates = {};
    ['srt_project_conversations', 'srt_project_subtitles', 'srt_project_edit_state', 'srt_project_subtitle_drafts'].forEach(function(key) {
      var raw = storage.getItem(key);
      if (raw === null) return;
      var map = JSON.parse(raw);
      if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('项目记录无法读取');
      if (key === 'srt_project_subtitle_drafts') {
        Object.keys(map).forEach(function(k) {
          var pair = JSON.parse(k);
          if (Array.isArray(pair) && pair[0] === id) delete map[k];
        });
      } else delete map[id];
      updates[key] = JSON.stringify(map);
    });
    var next = projects.filter(function(p) { return p.id !== id; });
    if (storage.getItem('srt_active_project_id') === id) {
      updates.srt_active_project_id = next.length ? next[0].id : null;
      updates.srt_video = null;
    }
    updates.srt_projects = JSON.stringify(next);
    var saved = [];
    try {
      Object.keys(updates).forEach(function(key) {
        saved.push([key, storage.getItem(key)]);
        if (updates[key] === null) storage.removeItem(key);
        else storage.setItem(key, updates[key]);
      });
    } catch (error) {
      saved.reverse().forEach(function(entry) {
        if (entry[1] === null) storage.removeItem(entry[0]);
        else storage.setItem(entry[0], entry[1]);
      });
      throw error;
    }
    return true;
  }
  if (typeof module === 'object' && module.exports) module.exports = {deleteProject: deleteProject};
  if (root) root.SRTProjectDelete = {deleteProject: deleteProject};
})(typeof window === 'undefined' ? null : window);
