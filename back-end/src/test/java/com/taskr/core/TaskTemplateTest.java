package com.taskr.core;

import com.taskr.core.Resources.TaskTemplate;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

public class TaskTemplateTest {

    @Test
    public void taskTemplateHasExpectedTimeToComplete() {
        TaskTemplate underTest = new TaskTemplate("Wash the dishes!", 300, 300);
        assertThat(underTest.getMinutesExpectedToComplete()).isInstanceOf(Integer.class);

    }
    @Test
    public void taskTemplateCanSetExpectedTimeToComplete() {
        TaskTemplate underTest = new TaskTemplate("Clean your room", 300, 300);
        underTest.setMinutesExpectedToComplete(10);
        assertThat(underTest.getMinutesExpectedToComplete()).isEqualTo(10);
    }

    @Test
    public void taskTemplateHasActualWorkTime(){
        TaskTemplate underTest = new TaskTemplate("Wash the dishes!", 300, 300);
        assertThat(underTest.getActualWorkTime()).isInstanceOf(Integer.class);
    }

    @Test
    public void taskTemplateCanHaveDifferentExpectedVersusActualWorkTime(){
        TaskTemplate underTest = new TaskTemplate("Do the laundry", 300, 300);
        underTest.setMinutesExpectedToComplete(150);
        underTest.setActualWorkTime(20);
        assertThat(underTest.getMinutesExpectedToComplete()).isEqualTo(150);
        assertThat(underTest.getActualWorkTime()).isEqualTo(20);
    }
}
