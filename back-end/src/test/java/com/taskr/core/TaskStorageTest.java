package com.taskr.core;


import com.taskr.core.resources.TaskTemplate;
import com.taskr.core.resources.User;
import com.taskr.core.storages.TaskStorage;
import org.junit.jupiter.api.Test;

import static org.mockito.Mockito.*;

public class TaskStorageTest {

    @Test
    public void shouldHaveAnAddTaskMethod(){
        TaskStorage taskStorage = mock(TaskStorage.class);
        TaskTemplate taskTemplate = new TaskTemplate("test task template", 300, 300);
        User testUser = new User("Aloo");
        Task testTask = new Task(testUser , taskTemplate);
        taskStorage.save(testTask);
        verify(taskStorage).save(testTask);
    }

    @Test
    public void shouldHaveADeleteTaskMethod(){
        TaskStorage taskStorage = mock(TaskStorage.class);
        TaskTemplate taskTemplate = new TaskTemplate("test task template", 300, 300);
        User testUser = new User("Aloo");
        Task testTask = new Task(testUser , taskTemplate);
        taskStorage.save(testTask);
        taskStorage.deleteById(1L);
        verify(taskStorage).deleteById(1L);
    }

    @Test
    public void shouldHaveAFindAllMethod(){
        TaskStorage taskStorage = mock(TaskStorage.class);
        taskStorage.findAll();
        verify(taskStorage).findAll();

    }

    @Test
    public void shouldBeAbleToFindTaskByName(){
        TaskStorage taskStorage = mock(TaskStorage.class);
        taskStorage.findById(1L);
        verify(taskStorage).findById(1L);

    }
}