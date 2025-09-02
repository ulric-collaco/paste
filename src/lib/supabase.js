import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Database operations
export const db = {
  // Create or update a paste entry
  async createOrUpdateEntry(data, passcode) {
    if (data.is_guest) {
      // Guest mode: upsert a single shared entry
      const { data: entry, error } = await supabase
        .from('entries')
        .upsert({
          slug: 'guest-paste', // Fixed slug for the shared guest paste
          content: data.content,
          is_guest: true,
          updated_at: new Date().toISOString()
        }, { onConflict: 'slug' })
        .select()
        .single();

      if (error) throw error;
      return entry;
    }
    
    if (passcode) {
      // For passcode mode: check if entry exists, if yes update it, if no create it
      const { data: existingEntry, error: fetchError } = await supabase
        .from('entries')
        .select('*')
        .eq('passcode', passcode)
        .single()

      if (existingEntry) {
        // Update existing entry
        const { data: updatedEntry, error: updateError } = await supabase
          .from('entries')
          .update({
            content: data.content,
            updated_at: new Date().toISOString()
          })
          .eq('passcode', passcode)
          .select()
          .single()
        
        if (updateError) throw updateError
        return updatedEntry
      } else {
        // Create new entry with passcode
        const { data: newEntry, error: createError } = await supabase
          .from('entries')
          .insert([{
            ...data,
            passcode: passcode
          }])
          .select()
          .single()
        
        if (createError) throw createError
        return newEntry
      }
    }

    // Fallback for old guest mode or other cases - create a new entry
    const { data: entry, error } = await supabase
      .from('entries')
      .insert([data])
      .select()
      .single()
    
    if (error) throw error
    return entry
  },

  async getEntry(slug) {
    const { data: entry, error } = await supabase
      .from('entries')
      .select(`
        *,
        files (*)
      `)
      .eq('slug', slug)
      .single()
    
    if (error) throw error
    return entry
  },

  async getEntryByPasscode(passcode) {
    const { data: entry, error } = await supabase
      .from('entries')
      .select(`
        *,
        files (*)
      `)
      .eq('passcode', passcode)
      .single()
    
    if (error && error.code !== 'PGRST116') throw error // PGRST116 = not found
    return entry
  },

  // Delete entry (only for passcode mode)
  async deleteEntry(id) {
    const { error } = await supabase
      .from('entries')
      .delete()
      .eq('id', id)
    
    if (error) throw error
  },

  // Clear content of entry (alternative to delete)
  async clearEntry(passcode) {
    const { data: clearedEntry, error } = await supabase
      .from('entries')
      .update({ 
        content: '',
        updated_at: new Date().toISOString()
      })
      .eq('passcode', passcode)
      .select()
      .single()
    
    if (error) throw error
    return clearedEntry
  },

  // Upload file to storage
  async uploadFile(file, entryId) {
    const fileExt = file.name.split('.').pop()
    const fileName = `${entryId}_${Date.now()}.${fileExt}`
    const filePath = `uploads/${fileName}`

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(filePath, file)

    if (uploadError) throw uploadError

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('uploads')
      .getPublicUrl(filePath)

    // Save file record
    const { data: fileRecord, error: fileError } = await supabase
      .from('files')
      .insert([{
        entry_id: entryId,
        file_url: publicUrl,
        file_name: file.name
      }])
      .select()
      .single()

    if (fileError) throw fileError
    return { ...fileRecord, publicUrl }
  },

  // Clean up expired guest entries (called by Supabase cron)
  async cleanupExpiredEntries() {
    const { error } = await supabase
      .from('entries')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .eq('is_guest', true)
    
    if (error) throw error
  },

}

// Utility functions
export const utils = {
  // Generate unique slug
  generateSlug(length = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  },

  // Check if file is image
  isImageFile(fileName) {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']
    const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'))
    return imageExtensions.includes(ext)
  },

  // Format file size
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  },

  // Copy to clipboard
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (err) {
      console.error('Failed to copy: ', err)
      return false
    }
  }
}
