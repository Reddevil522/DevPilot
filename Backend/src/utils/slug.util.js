const Project = require('../models/project.model');

/**
 * Generates a unique slug for a project per user.
 * @param {string} name - The project name.
 * @param {string} ownerId - The owner's user ID.
 * @returns {Promise<string>} - The unique slug.
 */
const generateUniqueSlug = async (name, ownerId) => {
  // 1. Base slug generation
  let baseSlug = (name || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // replace spaces with -
    .replace(/[^\w\-]+/g, '') // remove unsafe characters
    .replace(/\-\-+/g, '-') // remove duplicate -
    .replace(/^-+/, '') // remove leading -
    .replace(/-+$/, ''); // remove trailing -

  if (!baseSlug) {
    baseSlug = 'project';
  }

  // 2. Check for uniqueness per owner
  let slug = baseSlug;
  let counter = 2;
  let exists = true;

  while (exists) {
    // Check if the slug exists for this specific user
    const project = await Project.findOne({ ownerId, slug });
    if (project) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    } else {
      exists = false;
    }
  }

  return slug;
};

module.exports = { generateUniqueSlug };
