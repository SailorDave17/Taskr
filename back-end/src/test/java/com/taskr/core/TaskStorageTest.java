package com.taskr.core;


import com.taskr.core.Resources.Task;
import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import com.taskr.core.Storages.TaskStorage;
import org.junit.jupiter.api.Test;

import static org.mockito.Mockito.*;

public class TaskStorageTest {

    @Test
    public void shouldHaveAnAddTaskMethod(){
        TaskStorage taskStorage = mock(TaskStorage.class);
        TaskTemplate taskTemplate = new TaskTemplate("test task template");
        User testUser = new User("Aloo");
        Task testTask = new Task(testUser , taskTemplate);
        taskStorage.save(testTask);
        verify(taskStorage).save(testTask);
    }

    @Test
    public void shouldHaveADeleteTaskMethod(){
        TaskStorage taskStorage = mock(TaskStorage.class);
        TaskTemplate taskTemplate = new TaskTemplate("test task template");
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