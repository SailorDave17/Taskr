package com.taskr.core.Storages;

import com.taskr.core.Resources.Task;
import com.taskr.core.Resources.TaskTemplate;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class TaskTemplateStorage {

    private TaskTemplateRepository taskTemplateRepo;


    public TaskTemplateStorage(TaskTemplateRepository taskTemplateRepo) {
        this.taskTemplateRepo = taskTemplateRepo;
    }

    public void save(TaskTemplate taskTemplate) {
        taskTemplateRepo.save(taskTemplate);
    }

    public void deleteById(Long id) {
        taskTemplateRepo.deleteById(id);
    }

    public Iterable<TaskTemplate> findAll() {
        return taskTemplateRepo.findAll();
    }

    public TaskTemplate findById(Long id) {
        if (taskTemplateRepo.findById(id).isPresent()) {
            return taskTemplateRepo.findById(id).get();
        } else return null;
    }

    public void allocateTasks(List<Task> taskList) {
    }
}