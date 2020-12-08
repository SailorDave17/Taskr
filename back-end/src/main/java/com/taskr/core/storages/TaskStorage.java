package com.taskr.core.storages;

import com.taskr.core.Resources.Task;
import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import org.springframework.stereotype.Service;

@Service
public class TaskStorage {

    private TaskRepository taskRepo;


    public TaskStorage(TaskRepository taskRepo) {
        this.taskRepo = taskRepo;
    }

    public void save(Task task) {
        taskRepo.save(task);
    }

    public void deleteById(Long id) {
        taskRepo.deleteById(id);
    }

    public void deleteByTemplateId(Long templateId){
        for (Task task : taskRepo.findTasksByTemplateId(templateId)){
            taskRepo.delete(task);
        }
    }

    public Iterable<Task> findAll() {
        return taskRepo.findAll();
    }

    public Task findById(Long id) {
        User dummyOwner = new User("Dummy user");
        TaskTemplate dummyTaskTemplate = new TaskTemplate("Task not found", 300, 300);
        Task dummyTask = new Task(dummyOwner, dummyTaskTemplate);
        if (taskRepo.findById(id).isPresent()) {
            return taskRepo.findById(id).get();
        } else return dummyTask;
    }

    public Iterable<Task> findByTemplateId(Long templateId){
        return taskRepo.findTasksByTemplateId(templateId);
    }
}
